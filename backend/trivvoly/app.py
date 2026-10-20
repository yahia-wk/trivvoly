"""The web app: REST endpoints for creating and joining rooms, one WebSocket per screen,
and the built frontend. Run with `python -m trivvoly`."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import socket
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from starlette.staticfiles import StaticFiles

from .config import Config
from .db import make_engine
from .game import CommandError
from .library import MAX_QUIZ_BYTES, load_library
from .quiz import validate_quiz
from .rooms import CODE, Connection, Room, RoomError, RoomStore
from .security import LIMITS, BodyLimit, RateLimiter, SecurityHeaders, client_ip, is_https, room_cookie, same_origin

log = logging.getLogger("trivvoly")
COOKIE_AGE = 12 * 60 * 60
TV_EFFECTS = {"tune", "read", "lounge", "mute", "fullscreen", "hint", "volume", "close_panels"}


def error(status: int, message: str, **extra: Any) -> JSONResponse:
    return JSONResponse({"error": message, **extra}, status_code=status)


def lan_address() -> str | None:
    """This computer's address on the local network (no packets are sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))  # a documentation address; connect() on UDP just picks a route
            ip = s.getsockname()[0]
            return None if ip.startswith("127.") else ip
    except OSError:
        return None


def create_app(config: Config | None = None, *, reset: bool = False, extra_quizzes: list[Path] | None = None) -> FastAPI:
    config = config or Config()
    library, warnings = load_library(config.quizzes_dir, extra_quizzes)
    engine = make_engine(config.database_url)
    rooms = RoomStore(config, engine)
    restored = rooms.load(reset=reset)
    limiter = RateLimiter()

    # ---------- live updates ----------
    async def push(room: Room) -> None:
        """Send every screen in the room its view of the current state."""
        room.game.advance()
        host_view = None
        for c in list(room.connections):
            try:
                if c.role == "host":
                    host_view = host_view or room.game.host_view(room.online_team_ids(), room.tv_online())
                    await c.send({"type": "state", "view": host_view})
                else:
                    team = room.game.st.teams.get(c.team_id)
                    if team is None:
                        await c.send({"type": "kicked"})
                        await c.close()
                        continue
                    await c.send({"type": "state", "view": room.game.player_view(team)})
            except Exception:  # a connection that just went away
                with contextlib.suppress(ValueError):
                    room.connections.remove(c)

    async def close_room(room: Room) -> None:
        rooms.remove(room.code)
        for c in list(room.connections):
            with contextlib.suppress(Exception):
                await c.send({"type": "closed"})
                await c.close()
        room.connections.clear()

    async def housekeeping() -> None:
        last_save = last_sweep = 0.0
        while True:
            await asyncio.sleep(0.2)
            t = time.time()
            for room in list(rooms.rooms.values()):
                wake = room.game.next_wakeup()
                if wake is not None and wake <= t and room.game.advance(t):
                    room.touch()
                    await push(room)
            if t - last_save > 2:
                last_save = t
                with contextlib.suppress(Exception):
                    rooms.save_dirty()
            if t - last_sweep > 60:
                last_sweep = t
                limiter.sweep()
                for room in rooms.expired(t):
                    log.info("room %s expired", room.code)
                    await close_room(room)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        task = asyncio.create_task(housekeeping())
        yield
        task.cancel()
        rooms.save_dirty()

    app = FastAPI(title="Trivvoly", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(BodyLimit, overrides={"/api/rooms": MAX_QUIZ_BYTES + 64 * 1024, "/api/quizzes/check": MAX_QUIZ_BYTES + 64 * 1024})
    app.add_middleware(SecurityHeaders)
    app.state.rooms, app.state.library, app.state.warnings, app.state.restored = rooms, library, warnings, restored

    def limited(kind: str, who: str) -> bool:
        n, window = LIMITS[kind]
        return not limiter.allow(f"{kind}:{who}", n, window)

    def site_url(request: Request | WebSocket) -> str:
        if config.public_url:
            return config.public_url
        host = request.headers.get("host", f"localhost:{config.port}")
        if host.split(":")[0] in ("localhost", "127.0.0.1", "[::1]"):
            lan = lan_address()
            if lan:
                return f"http://{lan}:{config.port}"
        return f"{'https' if is_https(request.scope, config) else 'http'}://{host}"

    async def json_body(request: Request) -> dict[str, Any]:
        if not request.headers.get("content-type", "").startswith("application/json"):
            raise RoomError(415, "Send JSON.")
        try:
            body = await request.json()
        except ValueError:
            raise RoomError(400, "That request wasn’t valid JSON.") from None
        if not isinstance(body, dict):
            raise RoomError(400, "That request wasn’t valid JSON.")
        return body

    @app.exception_handler(RoomError)
    async def room_error(_: Request, e: RoomError) -> JSONResponse:
        return error(e.status, str(e))

    @app.middleware("http")
    async def origin_guard(request: Request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS") and not same_origin(request.scope):
            return error(403, "Requests must come from Trivvoly itself.")
        return await call_next(request)

    def room_or_404(request: Request, code: str) -> Room:
        room = rooms.get(code)
        if room is None:
            if limited("miss", client_ip(request.scope, config)):
                raise RoomError(429, "Slow down a little and try again in a minute.")
            raise RoomError(404, "That game has ended or doesn’t exist.")
        return room

    # ---------- REST ----------
    @app.get("/healthz")
    async def healthz() -> Response:
        return Response("ok", media_type="text/plain")

    @app.get("/api/quizzes")
    async def quizzes() -> dict:
        return {"quizzes": [q.summary() for q in library.values()]}

    @app.get("/api/quizzes/{quiz_id}")
    async def quiz_file(quiz_id: str) -> Response:
        """A built-in quiz in the file format, as a starting point for the quiz builder."""
        entry = library.get(quiz_id)
        return JSONResponse(entry.quiz.file_dict()) if entry else error(404, "That quiz doesn’t exist.")

    @app.post("/api/quizzes/check")
    async def check_quiz(request: Request) -> Response:
        """The quiz builder's live check: the same rules every quiz must pass."""
        if limited("check", client_ip(request.scope, config)):
            return error(429, "Slow down a little and try again in a minute.")
        body = await json_body(request)
        quiz, problems = validate_quiz(body.get("quiz"))
        if quiz is None:
            return JSONResponse({"ok": False, "problems": problems})
        return JSONResponse({"ok": True, "problems": [], "summary": {"rounds": len(quiz.rounds), "questions": quiz.question_count}})

    @app.post("/api/rooms")
    async def create_room(request: Request) -> Response:
        ip = client_ip(request.scope, config)
        if limited("create", ip):
            return error(429, "Slow down a little and try again in a minute.")
        body = await json_body(request)
        if isinstance(body.get("quizId"), str):
            entry = library.get(body["quizId"])
            if entry is None:
                return error(404, "That quiz doesn’t exist.")
            quiz, quiz_id = entry.quiz, entry.id
        elif "quiz" in body:
            quiz, problems = validate_quiz(body["quiz"])
            if quiz is None:
                return error(422, "That quiz file has problems.", problems=problems)
            quiz_id = None
        else:
            return error(400, "Pick a quiz.")
        room, key = rooms.create(quiz, quiz_id, ip)
        log.info("room %s created (%s)", room.code, quiz.title)
        res = JSONResponse({"code": room.code, "hostUrl": f"/r/{room.code}/host#k={key}"})
        res.set_cookie(**room_cookie("tvh", key, room.code, is_https(request.scope, config), COOKIE_AGE))
        return res

    @app.get("/api/rooms/{code}")
    async def room_info(request: Request, code: str) -> dict:
        room = room_or_404(request, code)
        return {"code": room.code, "quizName": room.game.st.settings.quiz_name}

    @app.post("/api/rooms/{code}/claim")
    async def claim(request: Request, code: str) -> Response:
        """The quizmaster's key, from the link's #fragment, becomes a cookie for this room only."""
        room = room_or_404(request, code)
        if limited("claim", client_ip(request.scope, config)):
            return error(429, "Slow down a little and try again in a minute.")
        key = (await json_body(request)).get("key")
        if not isinstance(key, str) or not room.is_host(key):
            return error(403, "That quizmaster link isn’t right. Ask whoever started the game for the link again.")
        res = JSONResponse({"ok": True})
        res.set_cookie(**room_cookie("tvh", key, room.code, is_https(request.scope, config), COOKIE_AGE))
        return res

    @app.post("/api/rooms/{code}/join")
    async def join(request: Request, code: str) -> Response:
        room = room_or_404(request, code)
        existing = room.game.team_by_token(request.cookies.get("tvp"))
        if existing:
            return JSONResponse({"id": existing.id, "name": existing.name})
        if limited("join", client_ip(request.scope, config)):
            return error(429, "Slow down a little and try again in a minute.")
        try:
            team, token = room.game.join((await json_body(request)).get("name"))
        except CommandError as e:
            return error(409 if "taken" in str(e) else 403 if "full" in str(e) else 400, str(e))
        room.touch()
        await push(room)
        res = JSONResponse({"id": team.id, "name": team.name})
        res.set_cookie(**room_cookie("tvp", token, room.code, is_https(request.scope, config), COOKIE_AGE))
        return res

    # ---------- WebSocket: one per screen ----------
    @app.websocket("/api/rooms/{code}/ws")
    async def ws(websocket: WebSocket, code: str) -> None:
        ip = client_ip(websocket.scope, config)
        room = rooms.get(code)
        if not same_origin(websocket.scope) or limited("connect", ip):
            await websocket.close(code=4403)
            return
        if room is None:
            limited("miss", ip)
            await websocket.accept()
            await websocket.send_json({"type": "closed"})
            await websocket.close()
            return
        role = websocket.query_params.get("role")
        screen = websocket.query_params.get("screen", "tv")
        team = None
        if role == "host":
            if not room.is_host(websocket.cookies.get("tvh")):
                await websocket.close(code=4401)
                return
        else:
            role, team = "player", room.game.team_by_token(websocket.cookies.get("tvp"))
        await websocket.accept()
        if role == "player" and team is None:
            await websocket.send_json({"type": "needjoin"})
            await websocket.close()
            return

        conn = Connection(role=role, team_id=team.id if team else None, send=websocket.send_json, close=websocket.close,
                          screen=(screen if screen in ("tv", "remote") else "tv") if role == "host" else "phone")
        room.connections.append(conn)
        if role == "host":
            await websocket.send_json({"type": "quiz", "quiz": room.game.quiz.public_dict(),
                                       "room": {"code": room.code, "joinUrl": f"{site_url(websocket)}/{room.code}", "siteUrl": site_url(websocket)}})
        await push(room)
        limit_kind = "host_msg" if role == "host" else "player_msg"
        conn_id = f"{room.code}:{id(conn)}"
        try:
            while True:
                msg = await websocket.receive_json()
                if not isinstance(msg, dict) or msg.get("type") != "cmd":
                    continue
                msg_id, cmd, args = msg.get("id"), str(msg.get("cmd", ""))[:30], msg.get("args") or {}
                if not isinstance(args, dict):
                    args = {}
                if limited(limit_kind, conn_id):
                    await websocket.send_json({"type": "result", "id": msg_id, "ok": False, "error": "Slow down a little."})
                    continue
                if rooms.get(code) is not room:
                    break  # the room ended while we were waiting
                try:
                    if role == "host" and cmd == "end":
                        await close_room(room)
                        break
                    if role == "host":
                        effect = room.game.host_command(cmd, args)
                    else:
                        room.game.player_command(room.game.st.teams[team.id], cmd, args)
                        effect = None
                    await websocket.send_json({"type": "result", "id": msg_id, "ok": True})
                except (CommandError, KeyError) as e:
                    msg_text = str(e) if isinstance(e, CommandError) else "You’re no longer in this game."
                    await websocket.send_json({"type": "result", "id": msg_id, "ok": False, "error": msg_text})
                    continue
                room.touch()
                if effect:
                    await handle_effect(room, conn, effect)
                if cmd != "tv_status" or role != "host":
                    await push(room)
                else:
                    await push_hosts(room)
        except (WebSocketDisconnect, RuntimeError, ValueError):
            pass
        finally:
            with contextlib.suppress(ValueError):
                room.connections.remove(conn)
            if rooms.get(code) is room:
                await push(room)

    async def push_hosts(room: Room) -> None:
        view = room.game.host_view(room.online_team_ids(), room.tv_online())
        for c in list(room.connections):
            if c.role == "host":
                with contextlib.suppress(Exception):
                    await c.send({"type": "state", "view": view})

    async def handle_effect(room: Room, sender: Connection, effect: dict[str, Any]) -> None:
        kind = effect.get("effect")
        if kind == "kick":
            gone = set(effect.get("teams") or [])
            for c in list(room.connections):
                if c.team_id in gone:
                    with contextlib.suppress(Exception):
                        await c.send({"type": "kicked"})
                        await c.close()
                    with contextlib.suppress(ValueError):
                        room.connections.remove(c)
        elif kind == "toast":
            await sender.send({"type": "toast", "text": effect.get("text", "")})
        elif kind in TV_EFFECTS:
            for c in room.connections:
                if c.role == "host" and c.screen == "tv":
                    with contextlib.suppress(Exception):
                        await c.send({"type": "effect", **effect})

    # ---------- The frontend (built React app) ----------
    dist = config.frontend_dir
    index_html = dist / "index.html"
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    def spa() -> Response:
        if index_html.is_file():
            return FileResponse(index_html, media_type="text/html", headers={"Cache-Control": "no-store"})
        return Response("The frontend hasn’t been built yet: run `npm run build` in frontend/.", media_type="text/plain", status_code=503)

    @app.get("/")
    async def home() -> Response:
        return spa()

    @app.get("/r/{code}")
    @app.get("/r/{code}/{screen}")
    async def room_page(request: Request, code: str, screen: str = "") -> Response:
        if screen not in ("", "host", "remote") or not CODE.match(code):
            return Response("Not found", status_code=404, media_type="text/plain")
        if rooms.get(code) is None:
            if limited("miss", client_ip(request.scope, config)):
                return error(429, "Slow down a little and try again in a minute.")
            return RedirectResponse(f"/?missing={code}", status_code=302)
        return spa()

    @app.get("/favicon.ico")
    async def favicon() -> Response:
        return Response(status_code=204)

    @app.get("/{code}")
    async def short_join(request: Request, code: str) -> Response:
        """Short join links: /K7QM2X"""
        code = code.upper()
        if CODE.match(code) and rooms.get(code):
            return RedirectResponse(f"/r/{code}", status_code=302)
        if limited("miss", client_ip(request.scope, config)):
            return error(429, "Slow down a little and try again in a minute.")
        return Response("Not found", status_code=404, media_type="text/plain")

    return app

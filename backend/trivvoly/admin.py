"""The admin area: see what's happening, step in when something's wrong.

Admins are the accounts listed in ADMIN_EMAILS (after the usual sign-in), and only within a few hours
of signing in (ADMIN_SESSION_HOURS); after that they're asked to sign in again. To everyone else every
admin endpoint answers 404, as if it didn't exist. Every admin action is written to the admin log.
Admins see titles and counts of people's saved quizzes, not their contents.
"""
from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy import delete, func, or_, select

from .accounts import Accounts
from .config import Config
from .db import AdminLogRow, BanRow, SavedQuizRow, SessionRow, UserRow
from .observe import STARTED, event, metrics, recent
from .rooms import Room, RoomError, RoomStore
from .security import client_ip

NOT_FOUND = "Not found"


@dataclass
class AdminHooks:
    """What the admin area needs from the game server."""
    end_room: Callable[[Room, str], Awaitable[None]]       # (room, reason)
    remove_team: Callable[[Room, str], Awaitable[bool]]    # (room, team id) -> removed?


def room_summary(room: Room, t: float) -> dict[str, Any]:
    g = room.game
    online = room.online_team_ids()
    return {
        "code": room.code, "quiz": g.quiz.title, "builtIn": room.quiz_id,
        "createdAt": room.created_at, "lastActive": room.last_active, "ageMinutes": round((t - room.created_at) / 60),
        "slide": g.st.index + 1, "slides": len(g.slides),
        "screens": {"tv": room.tv_online(), "remotes": sum(c.role == "host" and c.screen == "remote" for c in room.connections),
                    "phones": sum(c.role == "player" for c in room.connections)},
        "teams": [{"id": tm.id, "name": tm.name, "online": tm.id in online} for tm in g.st.teams.values()],
        "ip": room.ip,
    }


def admin_routes(app: FastAPI, config: Config, accounts: Accounts, rooms: RoomStore, hooks: AdminHooks,
                 limited: Callable[[str, str], bool]) -> None:
    db = accounts._db
    run = accounts.run

    async def require_admin(request: Request) -> Any:
        user = await accounts.current_user(request)
        if not accounts.is_admin(user):
            raise RoomError(404, NOT_FOUND)
        if not accounts.is_fresh_admin(user):
            raise RoomError(401, "For safety, the admin area needs a recent sign-in. Please sign in again.")
        if limited("admin", user.id):
            raise RoomError(429, "Slow down a little.")
        return user

    def audit(admin: Any, action: str, target: str, detail: str = "") -> None:
        with db() as s:
            s.add(AdminLogRow(at=time.time(), admin=admin.email, action=action, target=target[:254], detail=detail[:500]))
            s.commit()
        event("admin_action", admin=admin.id, action=action, target=target[:80])

    def user_or_404(user_id: str) -> UserRow:
        with db() as s:
            u = s.get(UserRow, user_id) if len(user_id) <= 32 else None
        if u is None:
            raise RoomError(404, "No such account.")
        return u

    def not_an_admin(u: UserRow) -> None:
        if u.email in config.admin_emails:
            raise RoomError(400, "That’s an admin account. Remove it from ADMIN_EMAILS first.")

    # ---------- what's happening ----------
    @app.get("/api/admin/overview")
    async def overview(request: Request) -> dict:
        await require_admin(request)
        t = time.time()

        def counts() -> dict:
            with db() as s:
                week = t - 7 * 86400
                return {
                    "users": s.scalar(select(func.count()).select_from(UserRow)) or 0,
                    "newUsers7d": s.scalar(select(func.count()).select_from(UserRow).where(UserRow.created_at >= week)) or 0,
                    "activeUsers7d": s.scalar(select(func.count()).select_from(UserRow).where(UserRow.last_login >= week)) or 0,
                    "savedQuizzes": s.scalar(select(func.count()).select_from(SavedQuizRow)) or 0,
                    "banned": s.scalar(select(func.count()).select_from(BanRow)) or 0,
                }
        live = list(rooms.rooms.values())
        return {
            "now": t, "uptimeSeconds": round(t - STARTED),
            "games": {"live": len(live), "max": config.max_rooms,
                      "teams": sum(len(r.game.st.teams) for r in live),
                      "screens": sum(len(r.connections) for r in live),
                      "startedSinceBoot": metrics.total("trivvoly_rooms_created_total")},
            "accounts": await run(counts),
            "signInsSinceBoot": {"ok": metrics.total("trivvoly_sign_ins_total", result="ok"),
                                 "failed": metrics.total("trivvoly_sign_ins_total") - metrics.total("trivvoly_sign_ins_total", result="ok")},
            "errorsSinceBoot": recent.errors,
            "rateLimitedSinceBoot": metrics.total("trivvoly_rate_limited_total"),
            "switches": accounts.switches.admin(),
            "signIn": {"google": accounts.google is not None, "email": accounts.mailer.name if accounts.mailer else None},
            "problems": list(reversed(recent.items))[:50],
        }

    # ---------- games ----------
    @app.get("/api/admin/rooms")
    async def list_rooms(request: Request) -> dict:
        await require_admin(request)
        t = time.time()
        return {"rooms": [room_summary(r, t) for r in sorted(rooms.rooms.values(), key=lambda r: -r.last_active)]}

    @app.post("/api/admin/rooms/{code}/end")
    async def end_room(request: Request, code: str) -> dict:
        admin = await require_admin(request)
        room = rooms.get(code)
        if room is None:
            raise RoomError(404, "That game has already ended.")
        await hooks.end_room(room, "admin")
        await run(audit, admin, "end_game", code, room.game.quiz.title)
        return {"ok": True}

    @app.post("/api/admin/rooms/{code}/teams/{team_id}/remove")
    async def remove_team(request: Request, code: str, team_id: str) -> dict:
        admin = await require_admin(request)
        room = rooms.get(code)
        team = room.game.st.teams.get(team_id) if room else None
        if room is None or team is None:
            raise RoomError(404, "That team isn’t in a running game.")
        name = team.name
        await hooks.remove_team(room, team_id)
        await run(audit, admin, "remove_team", code, name)
        return {"ok": True}

    # ---------- accounts ----------
    @app.get("/api/admin/users")
    async def list_users(request: Request) -> dict:
        await require_admin(request)
        q = (request.query_params.get("q") or "").strip().lower()[:100]

        def find() -> list[dict]:
            with db() as s:
                stmt = select(UserRow).order_by(UserRow.created_at.desc()).limit(50)
                if q:
                    like = f"%{q.replace('%', '').replace('_', '')}%"
                    stmt = stmt.where(or_(func.lower(UserRow.email).like(like), func.lower(UserRow.name).like(like)))
                users = list(s.scalars(stmt))
                ids = [u.id for u in users]
                quizzes = dict(s.execute(select(SavedQuizRow.owner_id, func.count()).where(SavedQuizRow.owner_id.in_(ids)).group_by(SavedQuizRow.owner_id)).all()) if ids else {}
                banned = set(s.scalars(select(BanRow.email).where(BanRow.email.in_([u.email for u in users])))) if users else set()
                return [{"id": u.id, "email": u.email, "name": u.name, "google": u.google_sub is not None,
                         "createdAt": u.created_at, "lastLogin": u.last_login, "quizzes": quizzes.get(u.id, 0),
                         "banned": u.email in banned, "admin": u.email in config.admin_emails} for u in users]
        return {"users": await run(find)}

    @app.get("/api/admin/users/{user_id}/quizzes")
    async def user_quizzes(request: Request, user_id: str) -> dict:
        await require_admin(request)

        def load() -> list[dict]:
            with db() as s:
                rows = s.scalars(select(SavedQuizRow).where(SavedQuizRow.owner_id == user_id).order_by(SavedQuizRow.updated_at.desc()))
                return [{"id": r.id, "title": r.title, "ok": r.ok, "rounds": r.rounds, "questions": r.questions, "updatedAt": r.updated_at} for r in rows]
        return {"quizzes": await run(load)}

    @app.post("/api/admin/users/{user_id}/signout")
    async def sign_user_out(request: Request, user_id: str) -> dict:
        admin = await require_admin(request)
        u = await run(user_or_404, user_id)

        def end() -> None:
            with db() as s:
                s.execute(delete(SessionRow).where(SessionRow.user_id == u.id))
                s.commit()
        await run(end)
        await run(audit, admin, "sign_out_user", u.email)
        return {"ok": True}

    @app.post("/api/admin/users/{user_id}/ban")
    async def ban(request: Request, user_id: str) -> dict:
        admin = await require_admin(request)
        u = await run(user_or_404, user_id)
        not_an_admin(u)
        reason = str((await accounts.json_body(request)).get("reason") or "")[:200]

        def store() -> None:
            with db() as s:
                s.merge(BanRow(email=u.email, reason=reason, by=admin.email, created_at=time.time()))
                s.execute(delete(SessionRow).where(SessionRow.user_id == u.id))  # signed out everywhere, now
                s.commit()
        await run(store)
        await run(audit, admin, "ban", u.email, reason)
        return {"ok": True}

    @app.post("/api/admin/users/{user_id}/unban")
    async def unban(request: Request, user_id: str) -> dict:
        admin = await require_admin(request)
        u = await run(user_or_404, user_id)

        def remove() -> None:
            with db() as s:
                s.execute(delete(BanRow).where(BanRow.email == u.email))
                s.commit()
        await run(remove)
        await run(audit, admin, "unban", u.email)
        return {"ok": True}

    @app.delete("/api/admin/users/{user_id}")
    async def delete_user(request: Request, user_id: str) -> dict:
        admin = await require_admin(request)
        u = await run(user_or_404, user_id)
        not_an_admin(u)
        await run(accounts.wipe, u.id, u.email)
        event("account_deleted", user=u.id, by="admin")
        await run(audit, admin, "delete_account", u.email)
        return {"ok": True}

    @app.delete("/api/admin/quizzes/{quiz_id}")
    async def delete_quiz(request: Request, quiz_id: str) -> dict:
        admin = await require_admin(request)

        def remove() -> SavedQuizRow | None:
            with db() as s:
                row = s.get(SavedQuizRow, quiz_id) if len(quiz_id) <= 32 else None
                if row is None:
                    return None
                owner = s.get(UserRow, row.owner_id)
                s.delete(row)
                s.commit()
                row.owner_id = owner.email if owner else row.owner_id
                return row
        row = await run(remove)
        if row is None:
            raise RoomError(404, "That quiz doesn’t exist.")
        await run(audit, admin, "delete_quiz", row.owner_id, row.title)
        return {"ok": True}

    # ---------- switches ----------
    @app.get("/api/admin/switches")
    async def get_switches(request: Request) -> dict:
        await require_admin(request)
        return accounts.switches.admin()

    @app.put("/api/admin/switches")
    async def set_switches(request: Request) -> dict:
        admin = await require_admin(request)
        body = await accounts.json_body(request)
        sw = accounts.switches
        changes = []
        for field, key in (("pause_new_games", "pauseNewGames"), ("pause_sign_ups", "pauseSignUps")):
            if isinstance(body.get(key), bool) and body[key] != getattr(sw, field):
                setattr(sw, field, body[key])
                changes.append(f"{key}={body[key]}")
        if isinstance(body.get("notice"), str) and body["notice"].strip()[:200] != sw.notice:
            sw.notice = " ".join(body["notice"].split())[:200]
            changes.append(f"notice={sw.notice!r}")
        if changes:
            await run(sw.save, accounts.engine)
            await run(audit, admin, "switches", "site", ", ".join(changes))
        return sw.admin()

    # ---------- the admin log ----------
    @app.get("/api/admin/log")
    async def admin_log(request: Request) -> dict:
        await require_admin(request)

        def load() -> list[dict]:
            with db() as s:
                rows = s.scalars(select(AdminLogRow).order_by(AdminLogRow.at.desc()).limit(200))
                return [{"at": r.at, "admin": r.admin, "action": r.action, "target": r.target, "detail": r.detail} for r in rows]
        return {"entries": await run(load)}

    # ---------- for monitoring services ----------
    @app.get("/metrics")
    async def metrics_page(request: Request) -> Response:
        """Prometheus format. With METRICS_TOKEN set, send "Authorization: Bearer <token>"; admins can always look."""
        auth = request.headers.get("authorization", "")
        token_ok = bool(config.metrics_token) and secrets.compare_digest(auth.encode(), f"Bearer {config.metrics_token}".encode())
        if not token_ok:
            if limited("miss", client_ip(request.scope, config)) or not accounts.is_fresh_admin(await accounts.current_user(request)):
                return PlainTextResponse(NOT_FOUND, status_code=404)
        return PlainTextResponse(metrics.render(), media_type="text/plain; version=0.0.4")


__all__ = ["AdminHooks", "admin_routes"]

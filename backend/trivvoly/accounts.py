"""Quizmaster accounts: sign in with Google or an emailed link, and keep quizzes in your account.

Nobody needs an account to play or to host; it's for keeping quizzes. Being signed in is an
HttpOnly cookie (`tvs`) holding a random token; the database keeps only its hash.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import re
import secrets
import time
from typing import Any, Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .config import Config
from .db import LoginTokenRow, SavedQuizRow, SessionRow, UserRow
from .google import Attempt, GoogleClient, GoogleError, authorize_url, read_id_token
from .mail import Mailer, make_mailer, sign_in_email
from .moderation import is_offensive
from .quiz import Quiz, validate_quiz
from .rooms import RoomError
from .security import client_ip, is_https

log = logging.getLogger("trivvoly")

SESSION_COOKIE = "tvs"
GOOGLE_COOKIE = "tvg"
EMAIL = re.compile(r"^[^@\s\"<>()\[\],;:\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$")
NEXT = re.compile(r"^/(?![/\\])[A-Za-z0-9/_\-?=&.%]{0,199}$")
QUIZ_ID = re.compile(r"^[0-9a-f]{32}$")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def safe_next(value: Any, default: str = "/account") -> str:
    """Where to go after signing in: only a path on this site, never another site."""
    return value if isinstance(value, str) and NEXT.match(value) else default


def clean_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    name = " ".join(value.split())
    return name if 1 <= len(name) <= 40 and not is_offensive(name) else None


def public_user(user: UserRow) -> dict[str, Any]:
    return {"name": user.name, "email": user.email, "google": user.google_sub is not None}


def quiz_summary(row: SavedQuizRow) -> dict[str, Any]:
    return {"id": row.id, "title": row.title, "ok": row.ok, "rounds": row.rounds, "questions": row.questions, "updatedAt": row.updated_at}


def describe_quiz(data: Any) -> tuple[str, str, bool, int, int]:
    """What we store for a saved quiz: (json, title, ok, rounds, questions). Drafts that don't pass
    the checks yet are kept as they are, so work in progress isn't lost."""
    if not isinstance(data, dict):
        raise RoomError(400, "Send a quiz.")
    quiz, _ = validate_quiz(data)
    if quiz is not None:
        return json.dumps(quiz.file_dict(), ensure_ascii=False), quiz.title, True, len(quiz.rounds), quiz.question_count
    title = data.get("title") if isinstance(data.get("title"), str) and data["title"].strip() else "Untitled quiz"
    rounds = data.get("rounds") if isinstance(data.get("rounds"), list) else []
    questions = sum(len(r["questions"]) for r in rounds if isinstance(r, dict) and isinstance(r.get("questions"), list))
    return json.dumps(data, ensure_ascii=False), title[:80], False, len(rounds), questions


class Accounts:
    def __init__(self, config: Config, engine: Any, limited: Callable[[str, str], bool],
                 json_body: Callable[[Request], Awaitable[dict[str, Any]]]) -> None:
        self.config, self.engine, self.limited, self.json_body = config, engine, limited, json_body
        self.mailer: Mailer | None = make_mailer(config)
        self.google: GoogleClient | None = (GoogleClient(config.google_client_id, config.google_client_secret)
                                            if config.google_client_id and config.google_client_secret else None)

    # ---------- database helpers (run off the event loop) ----------
    def _db(self) -> Session:
        return Session(self.engine, expire_on_commit=False)

    async def run(self, fn: Callable[..., Any], *args: Any) -> Any:
        return await asyncio.to_thread(fn, *args)

    def _user_for_token(self, token: str) -> UserRow | None:
        with self._db() as db:
            row = db.get(SessionRow, _hash(token))
            if row is None or row.expires_at < time.time():
                return None
            return db.get(UserRow, row.user_id)

    async def current_user(self, request: Request) -> UserRow | None:
        token = request.cookies.get(SESSION_COOKIE)
        if not token or len(token) > 100:
            return None
        return await self.run(self._user_for_token, token)

    async def require_user(self, request: Request) -> UserRow:
        user = await self.current_user(request)
        if user is None:
            raise RoomError(401, "Sign in first.")
        return user

    def _sign_in(self, email: str, name: str, google_sub: str | None) -> tuple[UserRow, str]:
        """Find or make the account for this verified email (or Google account), and start a session."""
        t = time.time()
        with self._db() as db:
            user = db.scalar(select(UserRow).where(UserRow.google_sub == google_sub)) if google_sub else None
            user = user or db.scalar(select(UserRow).where(UserRow.email == email))
            if user is None:
                user = UserRow(id=secrets.token_hex(16), email=email, name=clean_name(name) or clean_name(email.split("@")[0][:40]) or "Quizmaster",
                               google_sub=google_sub, created_at=t, last_login=t)
                db.add(user)
                db.flush()  # the user row must exist before its session row
            elif google_sub and user.google_sub is None:
                user.google_sub = google_sub
            user.last_login = t
            token = secrets.token_urlsafe(32)
            db.add(SessionRow(token_hash=_hash(token), user_id=user.id, created_at=t, expires_at=t + self.config.session_days * 86400))
            db.commit()
            return user, token

    def _session_cookie(self, res: Response, request: Request, token: str) -> None:
        res.set_cookie(SESSION_COOKIE, token, max_age=self.config.session_days * 86400, path="/",
                       httponly=True, samesite="lax", secure=is_https(request.scope, self.config))

    def _base_url(self, request: Request) -> str:
        if self.config.public_url:
            return self.config.public_url
        return f"{'https' if is_https(request.scope, self.config) else 'http'}://{request.headers.get('host', 'localhost')}"

    def sweep(self) -> None:
        t = time.time()
        with self._db() as db:
            db.execute(delete(SessionRow).where(SessionRow.expires_at < t))
            db.execute(delete(LoginTokenRow).where(LoginTokenRow.expires_at < t))
            db.commit()

    def saved_quiz(self, user_id: str, quiz_id: str) -> SavedQuizRow | None:
        if not QUIZ_ID.match(quiz_id):
            return None
        with self._db() as db:
            row = db.get(SavedQuizRow, quiz_id)
            return row if row is not None and row.owner_id == user_id else None

    async def saved_quiz_for_game(self, request: Request, quiz_id: Any) -> Quiz:
        """A saved quiz, checked again, for POST /api/rooms {"savedQuizId": ...}."""
        user = await self.require_user(request)
        row = await self.run(self.saved_quiz, user.id, quiz_id) if isinstance(quiz_id, str) else None
        if row is None:
            raise RoomError(404, "That quiz isn’t in your account.")
        quiz, problems = validate_quiz(json.loads(row.quiz_json))
        if quiz is None:
            raise RoomError(422, f"“{row.title}” has a few things to fix first. Open it in the quiz builder.")
        return quiz

    # ---------- routes ----------
    def routes(self, app: FastAPI) -> None:
        config = self.config

        def slow_down() -> JSONResponse:
            return JSONResponse({"error": "Slow down a little and try again in a minute."}, status_code=429)

        @app.get("/api/auth/options")
        async def options() -> dict:
            return {"google": self.google is not None, "email": self.mailer is not None}

        @app.get("/api/me")
        async def me(request: Request) -> dict:
            user = await self.current_user(request)
            return {"user": public_user(user) if user else None}

        @app.patch("/api/me")
        async def update_me(request: Request) -> dict:
            user = await self.require_user(request)
            name = clean_name((await self.json_body(request)).get("name"))
            if name is None:
                raise RoomError(400, "Pick a name of 1 to 40 characters (and keep it friendly).")

            def save() -> None:
                with self._db() as db:
                    db.get(UserRow, user.id).name = name
                    db.commit()
            await self.run(save)
            user.name = name
            return {"user": public_user(user)}

        @app.delete("/api/me")
        async def delete_me(request: Request) -> Response:
            user = await self.require_user(request)

            def wipe() -> None:
                with self._db() as db:
                    db.execute(delete(SavedQuizRow).where(SavedQuizRow.owner_id == user.id))
                    db.execute(delete(SessionRow).where(SessionRow.user_id == user.id))
                    db.execute(delete(LoginTokenRow).where(LoginTokenRow.email == user.email))
                    db.execute(delete(UserRow).where(UserRow.id == user.id))
                    db.commit()
            await self.run(wipe)
            log.info("account deleted")
            res = JSONResponse({"ok": True})
            res.delete_cookie(SESSION_COOKIE, path="/")
            return res

        @app.post("/api/auth/signout")
        async def sign_out(request: Request) -> Response:
            token = request.cookies.get(SESSION_COOKIE) or ""
            everywhere = (await self.json_body(request)).get("everywhere") is True

            def end() -> None:
                with self._db() as db:
                    row = db.get(SessionRow, _hash(token))
                    if row is not None:
                        db.execute(delete(SessionRow).where(SessionRow.user_id == row.user_id) if everywhere
                                   else delete(SessionRow).where(SessionRow.token_hash == row.token_hash))
                        db.commit()
            await self.run(end)
            res = JSONResponse({"ok": True})
            res.delete_cookie(SESSION_COOKIE, path="/")
            return res

        # ----- email links -----
        @app.post("/api/auth/email")
        async def email_link(request: Request) -> Response:
            if self.mailer is None:
                return JSONResponse({"error": "Signing in by email isn’t set up on this server."}, status_code=404)
            body = await self.json_body(request)
            email = body.get("email").strip().lower() if isinstance(body.get("email"), str) else ""
            if len(email) > 254 or not EMAIL.match(email):
                raise RoomError(400, "That doesn’t look like an email address.")
            # Per address and per inbox, so nobody can flood someone's inbox with links
            if self.limited("signin_email", client_ip(request.scope, config)) or self.limited("signin_to", email):
                return slow_down()
            token, nxt = secrets.token_urlsafe(32), safe_next(body.get("next"))

            def store() -> None:
                with self._db() as db:
                    db.add(LoginTokenRow(token_hash=_hash(token), email=email, next=nxt, expires_at=time.time() + config.login_link_minutes * 60))
                    db.commit()
            await self.run(store)
            # The token travels in the #fragment: it never reaches server logs, and opening the link
            # doesn't use it up (the page posts it), so mail scanners that follow links can't spend it.
            link = f"{self._base_url(request)}/signin/email#t={token}"
            try:
                await self.mailer.send(sign_in_email(email, link, config.login_link_minutes))
            except Exception:
                log.exception("couldn't send a sign-in email")
                return JSONResponse({"error": "We couldn’t send the email just now. Try again in a minute."}, status_code=502)
            return JSONResponse({"ok": True})

        @app.post("/api/auth/email/verify")
        async def email_verify(request: Request) -> Response:
            if self.limited("signin_verify", client_ip(request.scope, config)):
                return slow_down()
            token = (await self.json_body(request)).get("token")
            if not isinstance(token, str) or len(token) > 100:
                raise RoomError(400, "That sign-in link isn’t right.")

            def use() -> LoginTokenRow | None:
                with self._db() as db:
                    row = db.get(LoginTokenRow, _hash(token))
                    if row is None:
                        return None
                    db.delete(row)  # once only, whatever happens next
                    db.commit()
                    return row if row.expires_at >= time.time() else None
            row = await self.run(use)
            if row is None:
                raise RoomError(400, "That sign-in link has expired or was already used. Ask for a new one.")
            user, session = await self.run(self._sign_in, row.email, "", None)
            res = JSONResponse({"user": public_user(user), "next": row.next})
            self._session_cookie(res, request, session)
            return res

        # ----- Google -----
        def google_redirect_uri(request: Request) -> str:
            return f"{self._base_url(request)}/api/auth/google/callback"

        @app.get("/api/auth/google/start")
        async def google_start(request: Request) -> Response:
            if self.google is None:
                return JSONResponse({"error": "Signing in with Google isn’t set up on this server."}, status_code=404)
            if self.limited("google", client_ip(request.scope, config)):
                return slow_down()
            attempt = Attempt.new()
            nxt = base64.urlsafe_b64encode(safe_next(request.query_params.get("next")).encode()).decode().rstrip("=")
            res = RedirectResponse(authorize_url(self.google.client_id, google_redirect_uri(request), attempt), status_code=302)
            # Lax, because the browser comes back to us from Google's site
            res.set_cookie(GOOGLE_COOKIE, f"{attempt.dump()}.{nxt}", max_age=600, path="/api/auth/google",
                           httponly=True, samesite="lax", secure=is_https(request.scope, config))
            return res

        @app.get("/api/auth/google/callback")
        async def google_callback(request: Request) -> Response:
            def fail(why: str) -> Response:
                log.info("Google sign-in failed: %s", why)
                res = RedirectResponse("/signin?error=google", status_code=302)
                res.delete_cookie(GOOGLE_COOKIE, path="/api/auth/google")
                return res

            if self.google is None:
                return fail("not configured")
            if self.limited("google", client_ip(request.scope, config)):
                return fail("rate limited")
            raw, _, nxt_b64 = (request.cookies.get(GOOGLE_COOKIE) or "").rpartition(".")
            attempt = Attempt.load(raw)
            state, code = request.query_params.get("state", ""), request.query_params.get("code", "")
            if attempt is None or not code or not secrets.compare_digest(state, attempt.state):
                return fail("state didn't match (or the person cancelled)")
            try:
                nxt = safe_next(base64.urlsafe_b64decode(nxt_b64 + "=" * (-len(nxt_b64) % 4)).decode())
            except ValueError:
                nxt = "/account"
            try:
                id_token = await self.google.exchange(code, google_redirect_uri(request), attempt.verifier)
                guser = read_id_token(id_token, self.google.client_id, attempt.nonce)
            except (GoogleError, ValueError) as e:
                return fail(str(e))
            except Exception as e:  # network trouble reaching Google
                return fail(repr(e))
            _, session = await self.run(self._sign_in, guser.email, guser.name, guser.sub)
            res = RedirectResponse(nxt, status_code=302)
            res.delete_cookie(GOOGLE_COOKIE, path="/api/auth/google")
            self._session_cookie(res, request, session)
            return res

        # ----- saved quizzes -----
        @app.get("/api/my/quizzes")
        async def my_quizzes(request: Request) -> dict:
            user = await self.require_user(request)

            def load() -> list[dict]:
                with self._db() as db:
                    rows = db.scalars(select(SavedQuizRow).where(SavedQuizRow.owner_id == user.id).order_by(SavedQuizRow.updated_at.desc()))
                    return [quiz_summary(r) for r in rows]
            return {"quizzes": await self.run(load)}

        @app.post("/api/my/quizzes")
        async def save_new(request: Request) -> Response:
            user = await self.require_user(request)
            if self.limited("save", user.id):
                return slow_down()
            data, title, ok, rounds, questions = describe_quiz((await self.json_body(request)).get("quiz"))

            def add() -> dict | None:
                t = time.time()
                with self._db() as db:
                    count = db.scalar(select(func.count()).select_from(SavedQuizRow).where(SavedQuizRow.owner_id == user.id)) or 0
                    if count >= config.max_saved_quizzes:
                        return None
                    row = SavedQuizRow(id=secrets.token_hex(16), owner_id=user.id, title=title, quiz_json=data, ok=ok,
                                       rounds=rounds, questions=questions, created_at=t, updated_at=t)
                    db.add(row)
                    db.commit()
                    return quiz_summary(row)
            summary = await self.run(add)
            if summary is None:
                raise RoomError(409, f"Your account holds up to {config.max_saved_quizzes} quizzes. Delete one to make room.")
            return JSONResponse(summary, status_code=201)

        @app.get("/api/my/quizzes/{quiz_id}")
        async def get_saved(request: Request, quiz_id: str) -> dict:
            user = await self.require_user(request)
            row = await self.run(self.saved_quiz, user.id, quiz_id)
            if row is None:
                raise RoomError(404, "That quiz isn’t in your account.")
            return {**quiz_summary(row), "quiz": json.loads(row.quiz_json)}

        @app.put("/api/my/quizzes/{quiz_id}")
        async def save_existing(request: Request, quiz_id: str) -> dict:
            user = await self.require_user(request)
            if self.limited("save", user.id):
                raise RoomError(429, "Slow down a little and try again in a minute.")
            data, title, ok, rounds, questions = describe_quiz((await self.json_body(request)).get("quiz"))

            def update() -> dict | None:
                with self._db() as db:
                    row = db.get(SavedQuizRow, quiz_id) if QUIZ_ID.match(quiz_id) else None
                    if row is None or row.owner_id != user.id:
                        return None
                    row.quiz_json, row.title, row.ok, row.rounds, row.questions, row.updated_at = data, title, ok, rounds, questions, time.time()
                    db.commit()
                    return quiz_summary(row)
            summary = await self.run(update)
            if summary is None:
                raise RoomError(404, "That quiz isn’t in your account.")
            return summary

        @app.delete("/api/my/quizzes/{quiz_id}")
        async def delete_saved(request: Request, quiz_id: str) -> dict:
            user = await self.require_user(request)

            def remove() -> int:
                with self._db() as db:
                    n = db.execute(delete(SavedQuizRow).where(SavedQuizRow.id == quiz_id, SavedQuizRow.owner_id == user.id)).rowcount
                    db.commit()
                    return n
            if not await self.run(remove):
                raise RoomError(404, "That quiz isn’t in your account.")
            return {"ok": True}

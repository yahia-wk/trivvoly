"""Security plumbing: client addresses, origin checks, cookies, rate limits, headers, size limits."""
from __future__ import annotations

import time
from typing import Any

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Config

# ---------- Who is asking ----------


def client_ip(scope: Scope, config: Config) -> str:
    """Behind one trusted proxy, the LAST X-Forwarded-For entry is the one that proxy added;
    earlier entries come from the client and could be faked to dodge rate limits."""
    if config.trust_proxy:
        hops = [h.strip() for h in Headers(scope=scope).get("x-forwarded-for", "").split(",") if h.strip()]
        if hops:
            return hops[-1]
    client = scope.get("client")
    return client[0] if client else "unknown"


def is_https(scope: Scope, config: Config) -> bool:
    if scope.get("scheme") in ("https", "wss"):
        return True
    return config.trust_proxy and Headers(scope=scope).get("x-forwarded-proto", "").split(",")[0].strip() == "https"


def same_origin(scope: Scope) -> bool:
    """Browsers send Origin on cross-site requests and on every WebSocket handshake. Cookies alone
    don't stop another site from opening a WebSocket to us, so the origin must be checked."""
    headers = Headers(scope=scope)
    origin = headers.get("origin")
    if not origin:
        return scope["type"] == "http"  # plain HTTP from scripts/tests; browsers always send it for WebSockets
    host = origin.split("://", 1)[-1].rstrip("/")
    return host == headers.get("host", "")


def room_cookie(name: str, value: str, code: str, secure: bool, max_age: int) -> dict[str, Any]:
    """Arguments for Response.set_cookie: readable only by the server, only for this room's API."""
    return {"key": name, "value": value, "path": f"/api/rooms/{code}", "max_age": max_age,
            "httponly": True, "samesite": "strict", "secure": secure}


# ---------- Rate limits ----------

class RateLimiter:
    """Fixed windows per key. Small and in-memory: fine for one server process."""

    def __init__(self) -> None:
        self.hits: dict[str, tuple[int, float]] = {}

    def allow(self, key: str, limit: int, window: float) -> bool:
        t = time.monotonic()
        n, reset = self.hits.get(key, (0, t + window))
        if reset <= t:
            n, reset = 0, t + window
        n += 1
        self.hits[key] = (n, reset)
        return n <= limit

    def sweep(self) -> None:
        t = time.monotonic()
        self.hits = {k: v for k, v in self.hits.items() if v[1] > t}


MIN, HOUR = 60, 3600
# Many players can share one address (a pub's Wi-Fi), so per-address limits are generous
# and the tight ones are per team or per connection.
LIMITS = {
    "create": (10, HOUR),       # new rooms per address
    "join": (60, 10 * MIN),     # new teams per address
    "claim": (20, 10 * MIN),    # quizmaster-key attempts per address
    "miss": (30, MIN),          # looking up room codes that don't exist (stops code guessing)
    "connect": (300, MIN),      # live connections per address
    "player_msg": (120, MIN),   # messages per team connection
    "check": (240, MIN),        # quiz-builder checks per address (one per pause in typing)
    "host_msg": (1200, MIN),    # messages per quizmaster connection
}

# ---------- Headers and size limits ----------

CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
])
BASE_HEADERS = [(b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"no-referrer"), (b"x-frame-options", b"DENY")]


class SecurityHeaders:
    """Every response: no sniffing, no referrer, no framing. HTML pages also get the CSP."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers += BASE_HEADERS
                ctype = next((v for k, v in headers if k == b"content-type"), b"")
                if ctype.startswith(b"text/html"):
                    headers.append((b"content-security-policy", CSP.encode()))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, wrapped)


class BodyLimit:
    """Refuse request bodies over a size limit (bigger for quiz uploads), counting what actually
    arrives rather than trusting Content-Length."""

    def __init__(self, app: ASGIApp, default: int = 16 * 1024, overrides: dict[str, int] | None = None) -> None:
        self.app, self.default, self.overrides = app, default, overrides or {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            return await self.app(scope, receive, send)
        limit = self.overrides.get(scope["path"], self.default)
        declared = Headers(scope=scope).get("content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            return await _too_big(send)
        received = 0

        async def limited() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _TooBig()
            return message

        try:
            await self.app(scope, limited, send)
        except _TooBig:
            await _too_big(send)


class _TooBig(Exception):
    pass


async def _too_big(send: Send) -> None:
    body = b'{"error":"That\xe2\x80\x99s too big."}'
    await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})

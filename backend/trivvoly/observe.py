"""Observability: structured logs, request IDs, a few metrics, and the recent problems the admin page shows.

Logs go to stdout (the host collects them): readable text on your own machine, one JSON object per
line online (LOG_FORMAT=json, the Docker image's default). Never logged: query strings, cookies,
request bodies, tokens or keys. Email addresses appear only as their domain.
"""
from __future__ import annotations

import contextvars
import json
import logging
import re
import secrets
import sys
import time
from collections import deque
from typing import Any, Callable

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger("trivvoly")
request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")
STARTED = time.time()
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
_RECORD_FIELDS = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {"message", "asctime"}


def event(name: str, level: int = logging.INFO, **fields: Any) -> None:
    """One thing that happened, with its details as separate fields (easy to search in JSON logs)."""
    log.log(level, name, extra={"event": name, **fields})


def email_domain(email: str) -> str:
    return email.rsplit("@", 1)[-1] if "@" in email else ""


# ---------- formatting ----------

def _fields(record: logging.LogRecord) -> dict[str, Any]:
    return {k: v for k, v in vars(record).items() if k not in _RECORD_FIELDS and k not in ("event", "color_message")}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if getattr(record, "event", None):
            out["event"] = record.event  # type: ignore[attr-defined]
        if rid := request_id.get():
            out["request_id"] = rid
        out.update({k: v for k, v in _fields(record).items() if v is not None})
        if record.exc_info:
            out["error"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__("  [%(asctime)s] %(message)s", datefmt="%H:%M:%S")

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        extra = " ".join(f"{k}={v}" for k, v in _fields(record).items() if v is not None)
        return f"{line}  {extra}" if extra and "\n" not in line else line


class RecentProblems(logging.Handler):
    """The last warnings and errors, kept in memory for the admin page."""

    def __init__(self, size: int = 200) -> None:
        super().__init__(level=logging.WARNING)
        self.items: deque[dict[str, Any]] = deque(maxlen=size)
        self.errors = 0

    def emit(self, record: logging.LogRecord) -> None:
        if record.levelno >= logging.ERROR:
            self.errors += 1
        self.items.append({"time": record.created, "level": record.levelname.lower(), "msg": record.getMessage()[:500],
                           "event": getattr(record, "event", None), "requestId": request_id.get() or None,
                           "error": (self.format(record).split("\n")[-1][:300] if record.exc_info else None)})


recent = RecentProblems()


def setup_logging(fmt: str = "text", level: str = "INFO") -> None:
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    out = logging.StreamHandler(sys.stdout)
    out.setFormatter(JsonFormatter() if fmt == "json" else TextFormatter())
    root.addHandler(out)
    root.setLevel(level.upper() if level.upper() in ("DEBUG", "INFO", "WARNING", "ERROR") else "INFO")
    attach_recent()
    # uvicorn's own info lines include WebSocket URLs with their query strings: warnings only
    for noisy in ("uvicorn", "uvicorn.error", "uvicorn.access", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def attach_recent() -> None:
    root = logging.getLogger()
    if recent not in root.handlers:
        recent.setFormatter(logging.Formatter("%(message)s"))
        root.addHandler(recent)


# ---------- metrics (Prometheus text format, no extra dependency) ----------

class Metrics:
    def __init__(self) -> None:
        self.counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
        self.help: dict[str, str] = {}
        self.gauges: list[tuple[str, str, Callable[[], dict[tuple[tuple[str, str], ...], float]]]] = []

    def inc(self, name: str, value: float = 1, **labels: str) -> None:
        key = (name, tuple(sorted(labels.items())))
        self.counters[key] = self.counters.get(key, 0) + value

    def describe(self, name: str, text: str) -> None:
        self.help[name] = text

    def gauge(self, name: str, text: str, read: Callable[[], dict[tuple[tuple[str, str], ...], float]]) -> None:
        self.gauges.append((name, text, read))

    def total(self, name: str, **labels: str) -> float:
        want = set(labels.items())
        return sum(v for (n, ls), v in self.counters.items() if n == name and want <= set(ls))

    def render(self) -> str:
        lines: list[str] = []

        def fmt(name: str, labels: tuple[tuple[str, str], ...], value: float) -> str:
            ls = ",".join(f'{k}="{str(v)}"' for k, v in labels)
            return f"{name}{{{ls}}} {value:g}" if ls else f"{name} {value:g}"

        names = sorted({n for n, _ in self.counters})
        for n in names:
            lines += [f"# HELP {n} {self.help.get(n, n)}", f"# TYPE {n} counter"]
            lines += [fmt(n, ls, v) for (m, ls), v in sorted(self.counters.items()) if m == n]
        for n, text, read in self.gauges:
            lines += [f"# HELP {n} {text}", f"# TYPE {n} gauge"]
            try:
                lines += [fmt(n, ls, v) for ls, v in read().items()]
            except Exception:  # a gauge that can't be read right now (e.g. the database) is left out
                log.warning("metric %s couldn't be read", n)
        return "\n".join(lines) + "\n"


metrics = Metrics()
for _name, _text in [
    ("trivvoly_http_requests_total", "HTTP requests, by method, route and status"),
    ("trivvoly_http_request_seconds_total", "Time spent answering HTTP requests, by route"),
    ("trivvoly_rooms_created_total", "Games started, by where the quiz came from"),
    ("trivvoly_rooms_ended_total", "Games ended, by why"),
    ("trivvoly_teams_joined_total", "Teams that joined a game"),
    ("trivvoly_sign_ins_total", "Sign-ins, by method and result"),
    ("trivvoly_rate_limited_total", "Requests refused for going too fast, by kind"),
    ("trivvoly_ws_messages_total", "Commands received over WebSockets, by role"),
]:
    metrics.describe(_name, _text)


# ---------- per-request logging ----------

class RequestLog:
    """Gives every request an ID (sent back as X-Request-ID and added to its log lines), then logs
    method, path (never the query string), status and time, and counts it."""

    def __init__(self, app: ASGIApp, trust_proxy: bool = False, ip_of: Callable[[Scope], str] | None = None) -> None:
        self.app, self.trust_proxy, self.ip_of = app, trust_proxy, ip_of

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        incoming = Headers(scope=scope).get("x-request-id", "")
        rid = incoming if self.trust_proxy and _REQUEST_ID.match(incoming) else secrets.token_hex(8)
        token = request_id.set(rid)
        start, status = time.perf_counter(), 500

        async def wrapped(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message).append("x-request-id", rid)
            await send(message)

        try:
            await self.app(scope, receive, wrapped)
        except Exception:
            log.exception("unhandled error", extra={"event": "error", "method": scope["method"], "path": scope["path"]})
            raise
        finally:
            took = time.perf_counter() - start
            # Every label value comes from a fixed set, so no client can grow the metrics without limit
            method = scope["method"] if scope["method"] in _METHODS else "OTHER"
            route = getattr(scope.get("route"), "path", None) or ("/assets" if scope["path"].startswith("/assets/") else "other")
            metrics.inc("trivvoly_http_requests_total", method=method, route=route, status=str(status))
            metrics.inc("trivvoly_http_request_seconds_total", took, route=route)
            # Floods of refused requests are counted, and logged once per window as "rate_limited", not line by line
            quiet = route in ("/healthz", "/assets", "/metrics") or method in ("OPTIONS", "OTHER") or status == 429
            level = logging.WARNING if status >= 500 else logging.DEBUG if quiet else logging.INFO
            log.log(level, "%s %s %s", method, scope["path"][:200], status,
                    extra={"event": "request", "method": method, "path": scope["path"][:200], "route": route,
                           "status": status, "ms": round(took * 1000, 1), "ip": self.ip_of(scope) if self.ip_of else None})
            request_id.reset(token)

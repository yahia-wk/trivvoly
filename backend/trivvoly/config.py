"""Settings, all from environment variables so hosting needs no code changes."""
import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    port: int = field(default_factory=lambda: _int("PORT", 3000))
    # The commit this was built from (set in the Docker image by the release pipeline)
    version: str = field(default_factory=lambda: os.environ.get("TRIVVOLY_VERSION", "dev"))
    public_url: str = field(default_factory=lambda: os.environ.get("PUBLIC_URL", "").rstrip("/"))
    trust_proxy: bool = field(default_factory=lambda: os.environ.get("TRUST_PROXY") == "1")
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", f"sqlite:///{ROOT / 'trivvoly.db'}"))
    quizzes_dir: Path = field(default_factory=lambda: Path(os.environ.get("TRIVVOLY_QUIZZES", ROOT / "quizzes")))
    frontend_dir: Path = field(default_factory=lambda: Path(os.environ.get("TRIVVOLY_FRONTEND", ROOT / "frontend" / "dist")))
    max_rooms: int = field(default_factory=lambda: _int("TRIVVOLY_MAX_ROOMS", 300))
    max_rooms_per_ip: int = field(default_factory=lambda: _int("TRIVVOLY_MAX_ROOMS_PER_IP", 5))
    room_lifetime: int = 12 * 60 * 60   # seconds a room may live
    room_idle: int = 3 * 60 * 60        # ...or sit without anything happening

    # Accounts. Google sign-in is on when both Google settings are set. Email links are sent by
    # Resend (RESEND_API_KEY) or SMTP (SMTP_HOST...) from MAIL_FROM; with neither, and no PUBLIC_URL
    # (so: running on your own machine), the link is printed in the terminal instead.
    google_client_id: str = field(default_factory=lambda: os.environ.get("GOOGLE_CLIENT_ID", ""))
    google_client_secret: str = field(default_factory=lambda: os.environ.get("GOOGLE_CLIENT_SECRET", ""))
    mail_from: str = field(default_factory=lambda: os.environ.get("MAIL_FROM", ""))
    resend_api_key: str = field(default_factory=lambda: os.environ.get("RESEND_API_KEY", ""))
    smtp_host: str = field(default_factory=lambda: os.environ.get("SMTP_HOST", ""))
    smtp_port: int = field(default_factory=lambda: _int("SMTP_PORT", 587))
    smtp_user: str = field(default_factory=lambda: os.environ.get("SMTP_USER", ""))
    smtp_password: str = field(default_factory=lambda: os.environ.get("SMTP_PASSWORD", ""))
    session_days: int = 30              # how long "signed in" lasts without using the site
    login_link_minutes: int = 15        # how long an emailed sign-in link works
    max_saved_quizzes: int = field(default_factory=lambda: _int("TRIVVOLY_MAX_SAVED_QUIZZES", 100))

    # Shown on the privacy page, for questions about people's data
    contact_email: str = field(default_factory=lambda: os.environ.get("CONTACT_EMAIL", ""))
    # Admins: accounts whose (verified) email is listed here, comma-separated. Only this setting can
    # make someone an admin, so nothing stored in the database can.
    admin_emails: frozenset[str] = field(default_factory=lambda: frozenset(
        e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()))
    # The admin area needs a recent sign-in: a 30-day session cookie, if stolen, isn't enough
    admin_session_hours: int = field(default_factory=lambda: _int("ADMIN_SESSION_HOURS", 12))
    # Logs: "text" to read in a terminal, "json" for a hosting provider's log search (the Docker image's default)
    log_format: str = field(default_factory=lambda: os.environ.get("LOG_FORMAT", "text"))
    log_level: str = field(default_factory=lambda: os.environ.get("LOG_LEVEL", "INFO"))
    # GET /metrics for a monitoring service, with "Authorization: Bearer <this>" (admins can always see it)
    metrics_token: str = field(default_factory=lambda: os.environ.get("METRICS_TOKEN", ""))

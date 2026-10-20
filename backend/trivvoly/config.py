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

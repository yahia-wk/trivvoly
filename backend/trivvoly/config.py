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

"""Storage: running rooms, accounts, sign-in sessions and saved quizzes.
SQLite by default; set DATABASE_URL to a Postgres URL (postgresql+psycopg://...) to switch.
Secrets (host keys, session and sign-in tokens) are stored only as SHA-256 hashes."""
from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


class Base(DeclarativeBase):
    pass


class RoomRow(Base):
    __tablename__ = "rooms"
    code: Mapped[str] = mapped_column(String(6), primary_key=True)
    host_key_hash: Mapped[str] = mapped_column(String(64))
    ip: Mapped[str] = mapped_column(String(64))
    quiz_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    quiz_json: Mapped[str] = mapped_column(Text)
    state_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[float] = mapped_column(Float)
    last_active: Mapped[float] = mapped_column(Float)


class UserRow(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)   # lower-case
    name: Mapped[str] = mapped_column(String(60))
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    created_at: Mapped[float] = mapped_column(Float)
    last_login: Mapped[float] = mapped_column(Float)


class SessionRow(Base):
    """Being signed in on one browser."""
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[float] = mapped_column(Float)
    expires_at: Mapped[float] = mapped_column(Float)


class LoginTokenRow(Base):
    """An emailed sign-in link: works once, for a few minutes."""
    __tablename__ = "login_tokens"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), index=True)
    next: Mapped[str] = mapped_column(String(200))
    expires_at: Mapped[float] = mapped_column(Float)


class SavedQuizRow(Base):
    """A quiz in someone's account. Drafts with problems can be saved too (`ok` is False)."""
    __tablename__ = "saved_quizzes"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(80))
    quiz_json: Mapped[str] = mapped_column(Text)
    ok: Mapped[bool] = mapped_column(Boolean)
    rounds: Mapped[int] = mapped_column(Integer)
    questions: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[float] = mapped_column(Float)


class BanRow(Base):
    """An email address that can't sign in (or sign up again), set by an admin."""
    __tablename__ = "bans"
    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    reason: Mapped[str] = mapped_column(String(200))
    by: Mapped[str] = mapped_column(String(254))
    created_at: Mapped[float] = mapped_column(Float)


class AdminLogRow(Base):
    """Every admin action: who, what, to what, when."""
    __tablename__ = "admin_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[float] = mapped_column(Float, index=True)
    admin: Mapped[str] = mapped_column(String(254))
    action: Mapped[str] = mapped_column(String(40))
    target: Mapped[str] = mapped_column(String(254))
    detail: Mapped[str] = mapped_column(String(500))


class SettingRow(Base):
    """Site switches admins can flip while it runs (pause new games, a notice on the start page...)."""
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(String(500))


def make_engine(url: str):
    engine = create_engine(url, future=True)
    if engine.dialect.name == "sqlite":
        @event.listens_for(engine, "connect")
        def _foreign_keys(conn, _record):  # SQLite only checks foreign keys when asked, Postgres always does
            conn.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    return engine


__all__ = ["AdminLogRow", "BanRow", "Base", "LoginTokenRow", "SettingRow", "RoomRow", "SavedQuizRow", "Session", "SessionRow", "UserRow", "make_engine"]

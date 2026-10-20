"""Storage. One table for now (running rooms); accounts, quizzes and the question bank join it in Phase 2.
SQLite by default; set DATABASE_URL to a Postgres URL to switch."""
from __future__ import annotations

from sqlalchemy import Float, String, Text, create_engine
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


def make_engine(url: str):
    engine = create_engine(url, future=True)
    Base.metadata.create_all(engine)
    return engine


__all__ = ["Base", "RoomRow", "Session", "make_engine"]

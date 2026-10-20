"""Rooms: one game each, found by a short code, run by whoever holds the room's secret key.

Rooms expire on their own and their data (team names, answers) goes with them. Live rooms are
kept in memory and saved to the database shortly after each change, so a restart or deploy
doesn't end games.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import Config
from .db import RoomRow
from .game import Game, State
from .quiz import Quiz

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I mix-ups
CODE_LENGTH = 6                                     # 32^6, about a billion codes
CODE = re.compile(f"^[{CODE_ALPHABET}]{{{CODE_LENGTH}}}$")


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


@dataclass
class Connection:
    """One open screen: the TV or remote (role 'host') or a team's phone (role 'player')."""
    role: str
    team_id: str | None
    send: Any                      # async callable taking a dict
    close: Any                     # async callable
    screen: str = "phone"           # quizmasters: 'tv' or 'remote'


@dataclass
class Room:
    code: str
    host_key_hash: str
    ip: str
    quiz_id: str | None
    game: Game
    created_at: float
    last_active: float
    connections: list[Connection] = field(default_factory=list)
    dirty: bool = True

    def is_host(self, key: str | None) -> bool:
        return bool(key) and len(key) < 200 and secrets.compare_digest(hash_key(key), self.host_key_hash)

    def touch(self) -> None:
        self.last_active, self.dirty = time.time(), True

    def tv_online(self) -> bool:
        return any(c.role == "host" and c.screen == "tv" for c in self.connections)

    def online_team_ids(self) -> set[str]:
        return {c.team_id for c in self.connections if c.team_id}


class RoomError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class RoomStore:
    def __init__(self, config: Config, engine):
        self.config, self.engine = config, engine
        self.rooms: dict[str, Room] = {}

    # ----- lifecycle -----
    def create(self, quiz: Quiz, quiz_id: str | None, ip: str) -> tuple[Room, str]:
        if len(self.rooms) >= self.config.max_rooms:
            raise RoomError(503, "Trivvoly is very busy right now. Please try again in a little while.")
        if sum(r.ip == ip for r in self.rooms.values()) >= self.config.max_rooms_per_ip:
            raise RoomError(429, f"You already have {self.config.max_rooms_per_ip} games running. End one first, or wait for it to expire.")
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self.rooms:
                break
        key = secrets.token_hex(16)
        t = time.time()
        room = Room(code=code, host_key_hash=hash_key(key), ip=ip, quiz_id=quiz_id, game=Game(quiz), created_at=t, last_active=t)
        self.rooms[code] = room
        self.save_dirty()
        return room, key

    def get(self, code: Any) -> Room | None:
        return self.rooms.get(code) if isinstance(code, str) and CODE.match(code) else None

    def remove(self, code: str) -> Room | None:
        room = self.rooms.pop(code, None)
        with Session(self.engine) as s:
            s.execute(delete(RoomRow).where(RoomRow.code == code))
            s.commit()
        return room

    def expired(self, t: float | None = None) -> list[Room]:
        t = time.time() if t is None else t
        return [r for r in self.rooms.values()
                if t - r.created_at > self.config.room_lifetime
                or (t - r.last_active > self.config.room_idle and not r.connections)]

    # ----- saving -----
    def save_dirty(self) -> int:
        dirty = [r for r in self.rooms.values() if r.dirty]
        if not dirty:
            return 0
        with Session(self.engine) as s:
            for r in dirty:
                s.merge(RoomRow(code=r.code, host_key_hash=r.host_key_hash, ip=r.ip, quiz_id=r.quiz_id,
                                quiz_json=r.game.quiz.model_dump_json(), state_json=r.game.st.model_dump_json(),
                                created_at=r.created_at, last_active=r.last_active))
                r.dirty = False
            s.commit()
        return len(dirty)

    def load(self, reset: bool = False) -> int:
        with Session(self.engine) as s:
            if reset:
                s.execute(delete(RoomRow))
                s.commit()
                return 0
            for row in s.scalars(select(RoomRow)):
                try:
                    quiz = Quiz.model_validate_json(row.quiz_json)
                    game = Game(quiz, State.model_validate_json(row.state_json))
                except ValueError:
                    continue  # a room saved by an incompatible version: skip it, don't crash
                self.rooms[row.code] = Room(code=row.code, host_key_hash=row.host_key_hash, ip=row.ip, quiz_id=row.quiz_id,
                                            game=game, created_at=row.created_at, last_active=row.last_active, dirty=False)
        for r in self.expired():
            self.remove(r.code)
        return len(self.rooms)

"""Site switches admins can flip while Trivvoly runs, kept in the database so they survive restarts."""
from __future__ import annotations

from dataclasses import asdict, dataclass

from sqlalchemy.orm import Session

from .db import SettingRow


@dataclass
class Switches:
    pause_new_games: bool = False   # nobody can start a game (running ones carry on)
    pause_sign_ups: bool = False    # no new accounts (existing ones can still sign in)
    notice: str = ""                # shown at the top of the start page, e.g. "Maintenance at 9pm"

    def public(self) -> dict:
        return {"notice": self.notice, "newGamesPaused": self.pause_new_games}

    def admin(self) -> dict:
        return {"pauseNewGames": self.pause_new_games, "pauseSignUps": self.pause_sign_ups, "notice": self.notice}

    @classmethod
    def load(cls, engine) -> Switches:
        s = cls()
        with Session(engine) as db:
            for row in db.query(SettingRow).all():
                if row.key in ("pause_new_games", "pause_sign_ups"):
                    setattr(s, row.key, row.value == "1")
                elif row.key == "notice":
                    s.notice = row.value
        return s

    def save(self, engine) -> None:
        with Session(engine) as db:
            for key, value in asdict(self).items():
                db.merge(SettingRow(key=key, value=("1" if value else "0") if isinstance(value, bool) else value))
            db.commit()

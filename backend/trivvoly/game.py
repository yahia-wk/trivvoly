"""One game: the server-owned state machine for a room.

The quizmaster's screens (TV and phone remote) send commands; teams send answers, marks and
disputes. After every change each connection gets the view it is allowed to see: the
quizmaster sees everything, teams see only public information.

Time-based steps (the question timer running out, the winner drumroll, the dispute ruling
sequence) are stored as wall-clock times; `advance()` applies any that are due and
`next_wakeup()` says when the room needs looking at again.
"""
from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field

from . import moderation
from .marking import suggest
from .quiz import EmojiQ, FlagQ, MusicQ, Quiz, VersusQ, VowelsQ

MAX_TEAMS = 40
DRUMROLL = 2.65          # seconds of drumroll before the winner appears
DELIBERATE = 1.9         # seconds of "the quizmaster is deliberating…"
VERDICT_SHOWN = 2.6      # seconds the UPHELD / OVERTURNED stamp stays up
REVEALABLE = {"answer", "tb", "winner"}
TIMED = {"question", "tb"}


class CommandError(Exception):
    """A command that can't be carried out; the message is shown to the person who sent it."""


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def now() -> float:
    return time.time()


# ---------- Slides ----------

@dataclass(frozen=True)
class Slide:
    type: str
    r: int | None = None
    q: int | None = None
    t: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return {k: v for k, v in (("type", self.type), ("r", self.r), ("q", self.q), ("t", self.t)) if v is not None}


def build_slides(quiz: Quiz) -> list[Slide]:
    slides = [Slide("title"), Slide("rules")]
    for ri, rnd in enumerate(quiz.rounds):
        slides.append(Slide("round", r=ri))
        slides += [Slide("question", r=ri, q=qi) for qi in range(len(rnd.questions))]
        slides.append(Slide("swap", r=ri))
        slides += [Slide("answer", r=ri, q=qi) for qi in range(len(rnd.questions))]
        slides.append(Slide("standings", r=ri))
        if ri == quiz.halftimeAfter:
            slides.append(Slide("halftime"))
    if quiz.tiebreakers:
        slides.append(Slide("tbIntro"))
        slides += [Slide("tb", t=ti) for ti in range(len(quiz.tiebreakers))]
    slides += [Slide("winner"), Slide("end")]
    return slides


def qk_of(s: Slide) -> str | None:
    if s.type == "tb":
        return f"tb-{s.t}"
    if s.type in ("question", "answer"):
        return f"{s.r}-{s.q}"
    return None


# ---------- Stored state (saved to the database as JSON) ----------

class Team(BaseModel):
    id: str
    name: str
    token_hash: str | None = None          # None: added by the quizmaster, plays on paper
    joker: int = -1
    adj: float = 0
    manual: dict[int, float] = Field(default_factory=dict)  # round -> points typed in by the quizmaster
    joined: float = Field(default_factory=now)


class Answer(BaseModel):
    a: str = ""
    b: str = ""
    at: float = Field(default_factory=now)


class Mark(BaseModel):
    pts: int
    src: Literal["peer", "auto", "host"]


class Dispute(BaseModel):
    status: Literal["open", "upheld", "overturned"] = "open"
    reason: str = ""
    from_pts: int
    to_pts: int | None = None
    at: float = Field(default_factory=now)


class Timer(BaseModel):
    mode: Literal["none", "q", "break"] = "none"
    total: float = 0
    remaining: float = 0
    ends_at: float | None = None             # set while running
    done: bool = False

    def left(self, t: float) -> float:
        return max(0.0, self.ends_at - t) if self.ends_at is not None else self.remaining


class Theatre(BaseModel):
    """A dispute on the big screen."""
    key: str                                 # "<qk>|<team id>"
    phase: Literal["showing", "deliberating", "verdict"] = "showing"
    pts: int | None = None
    verdict: Literal["upheld", "overturned"] | None = None
    until: float | None = None               # when the current phase ends


class Settings(BaseModel):
    quiz_name: str
    seconds: int = 45
    break_minutes: int = 10
    auto_read: bool = False
    auto_timer: bool = False


class State(BaseModel):
    index: int = 0
    revealed: bool = False
    hint: bool = False
    rolling_until: float | None = None
    timer: Timer = Field(default_factory=Timer)
    settings: Settings
    teams: dict[str, Team] = Field(default_factory=dict)
    answers: dict[str, dict[str, Answer]] = Field(default_factory=dict)
    marks: dict[str, dict[str, Mark]] = Field(default_factory=dict)
    disputes: dict[str, dict[str, Dispute]] = Field(default_factory=dict)
    pairings: dict[int, dict[str, str]] = Field(default_factory=dict)  # round -> {marker: marked}
    seen: list[str] = Field(default_factory=list)       # questions shown so far (for the teams' answer sheets)
    revealed_keys: list[str] = Field(default_factory=list)
    theatre: Theatre | None = None
    parked: list[str] = Field(default_factory=list)


# ---------- The game ----------

class Game:
    def __init__(self, quiz: Quiz, state: State | None = None):
        self.quiz = quiz
        self.slides = build_slides(quiz)
        self.st = state or State(settings=Settings(quiz_name=quiz.title))
        self.st.index = min(max(self.st.index, 0), len(self.slides) - 1)
        self.tv: dict[str, Any] = {}         # the TV's local status (sound on, tune playing…), not saved

    # ----- helpers -----
    @property
    def slide(self) -> Slide:
        return self.slides[self.st.index]

    def question(self, qk: str):
        if qk.startswith("tb-"):
            return self.quiz.tiebreakers[int(qk[3:])]
        r, q = (int(x) for x in qk.split("-"))
        return self.quiz.rounds[r].questions[q]

    def valid_qk(self, qk: Any) -> bool:
        if not isinstance(qk, str) or len(qk) > 8:
            return False
        try:
            if qk.startswith("tb-"):
                return 0 <= int(qk[3:]) < len(self.quiz.tiebreakers)
            r, q = (int(x) for x in qk.split("-"))
            return 0 <= r < len(self.quiz.rounds) and 0 <= q < len(self.quiz.rounds[r].questions)
        except ValueError:
            return False

    def round_qks(self, r: int) -> list[str]:
        return [f"{r}-{q}" for q in range(len(self.quiz.rounds[r].questions))]

    def max_pts(self, qk: str) -> int:
        return 2 if not qk.startswith("tb-") and self.quiz.rounds[int(qk.split("-")[0])].kind == "music" else 1

    def open_qks(self) -> list[str]:
        s = self.slide
        if s.type == "question":
            return [f"{s.r}-{q}" for q in range(s.q + 1)]
        if s.type == "tb":
            return [f"tb-{s.t}"]
        return []

    def team(self, team_id: Any) -> Team:
        if not isinstance(team_id, str) or team_id not in self.st.teams:
            raise CommandError("That team isn’t in this game.")
        return self.st.teams[team_id]

    def team_by_token(self, token: str | None) -> Team | None:
        if not token or len(token) > 100:
            return None
        h = hash_token(token)
        return next((t for t in self.st.teams.values() if t.token_hash and secrets.compare_digest(t.token_hash, h)), None)

    # ----- time -----
    def advance(self, t: float | None = None) -> bool:
        """Apply any time-based steps that are due. Returns True if anything changed."""
        t = now() if t is None else t
        st, changed = self.st, False
        if st.timer.ends_at is not None and t >= st.timer.ends_at:
            st.timer.remaining, st.timer.ends_at, st.timer.done = 0, None, True
            changed = True
        if st.rolling_until is not None and t >= st.rolling_until:
            st.rolling_until, st.revealed = None, True
            changed = True
        th = st.theatre
        while th is not None and th.until is not None and t >= th.until:
            if th.phase == "deliberating":
                qk, team_id = th.key.split("|")
                self._set_mark(qk, team_id, th.pts, "host")
                d = st.disputes[qk][team_id]
                th.phase, th.verdict, th.until = "verdict", d.status if d.status != "open" else "upheld", th.until + VERDICT_SHOWN
            else:
                st.theatre = None
                self._show_next_dispute()
            th = st.theatre
            changed = True
        return changed

    def next_wakeup(self) -> float | None:
        times = [x for x in (self.st.timer.ends_at, self.st.rolling_until, self.st.theatre.until if self.st.theatre else None) if x is not None]
        return min(times) if times else None

    # ----- slides -----
    def _go(self, n: int, direction: int) -> None:
        if not 0 <= n < len(self.slides):
            return
        st = self.st
        st.index, st.hint, st.rolling_until = n, False, None
        s = self.slide
        st.revealed = direction < 0 and s.type in REVEALABLE and s.type != "winner"
        if s.type in TIMED:
            st.timer = Timer(mode="q", total=st.settings.seconds, remaining=st.settings.seconds)
        elif s.type == "halftime":
            st.timer = Timer(mode="break", total=st.settings.break_minutes * 60, remaining=st.settings.break_minutes * 60)
        else:
            st.timer = Timer()
        qk = qk_of(s)
        if qk and qk not in st.seen:
            st.seen.append(qk)
        if s.type in ("swap", "answer") and s.r not in st.pairings:
            self._pair_up(s.r)
        if st.revealed:
            self._record_reveal()

    def _record_reveal(self) -> None:
        qk = qk_of(self.slide)
        if qk and qk not in self.st.revealed_keys:
            self.st.revealed_keys.append(qk)

    def _reveal(self) -> None:
        s, st = self.slide, self.st
        if s.type == "winner":
            st.rolling_until = now() + DRUMROLL
            return
        st.revealed = True
        if st.timer.ends_at is not None:  # revealing pauses the timer
            st.timer.remaining, st.timer.ends_at = st.timer.left(now()), None
        self._record_reveal()

    def _pair_up(self, r: int) -> None:
        """Pens down: shuffle the phone teams into a circle and each one marks the next."""
        ids = [t.id for t in self.st.teams.values() if t.token_hash]
        if len(ids) < 2:
            return
        secrets.SystemRandom().shuffle(ids)
        self.st.pairings[r] = {ids[k]: ids[(k + 1) % len(ids)] for k in range(len(ids))}

    # ----- marks and disputes -----
    def _set_mark(self, qk: str, team_id: str, pts: int | None, src: str) -> None:
        marks = self.st.marks.setdefault(qk, {})
        if pts is None:
            marks.pop(team_id, None)
            return
        marks[team_id] = Mark(pts=pts, src=src)
        d = self.st.disputes.get(qk, {}).get(team_id)
        if src == "host" and d and d.status == "open":
            d.status, d.to_pts = ("upheld" if pts == d.from_pts else "overturned"), pts
            # Ruled from the answers panel while it was up on the big screen: take it down
            th = self.st.theatre
            if th and th.key == f"{qk}|{team_id}" and th.phase == "showing":
                self.st.theatre = None
                self._show_next_dispute()

    def open_disputes(self) -> list[tuple[str, str, Dispute]]:
        out = [(qk, tid, d) for qk, by in self.st.disputes.items() for tid, d in by.items() if d.status == "open" and tid in self.st.teams]
        return sorted(out, key=lambda x: x[2].at)

    def _show_next_dispute(self) -> None:
        if self.st.theatre is not None:
            return
        for qk, tid, _ in self.open_disputes():
            key = f"{qk}|{tid}"
            if key not in self.st.parked:
                self.st.theatre = Theatre(key=key)
                return

    # ----- scores -----
    def round_score(self, team: Team, r: int) -> float | None:
        got = [self.st.marks[qk][team.id].pts for qk in self.round_qks(r) if team.id in self.st.marks.get(qk, {})]
        return float(sum(got)) if got else team.manual.get(r)

    def total(self, team: Team) -> float:
        scores = [self.round_score(team, r) or 0 for r in range(len(self.quiz.rounds))]
        joker = scores[team.joker] if 0 <= team.joker < len(scores) else 0
        return sum(scores) + joker + team.adj

    def ranked(self) -> list[dict[str, Any]]:
        rows = sorted(({"id": t.id, "name": t.name, "total": self.total(t)} for t in self.st.teams.values()), key=lambda x: -x["total"])
        rank, prev = 0, None
        for k, row in enumerate(rows):
            if row["total"] != prev:
                rank, prev = k + 1, row["total"]
            row["rank"] = rank
        return rows

    # ======================================================================
    # Commands from the quizmaster's screens
    # ======================================================================
    def host_command(self, cmd: str, a: dict[str, Any]) -> dict[str, Any] | None:
        """Carry out a quizmaster command. Returns an effect for the TV (play a sound…) or None."""
        self.advance()
        st, s = self.st, self.slide

        if cmd in ("next", "prev", "jump"):
            if st.theatre is not None:
                raise CommandError("Rule on the dispute first, or tap Later.")
            if st.rolling_until is not None:
                raise CommandError("Hold on, the drumroll is playing.")
            if cmd == "next":
                if s.type in REVEALABLE and not st.revealed:
                    self._reveal()
                else:
                    self._go(st.index + 1, 1)
            elif cmd == "prev":
                self._go(st.index - 1, -1)
            else:
                n = a.get("index")
                if not isinstance(n, int) or not 0 <= n < len(self.slides):
                    raise CommandError("There’s no slide there.")
                self._go(n, 1 if n >= st.index else -1)
            return None

        if cmd == "timer":  # start / pause / restart
            tm = st.timer
            if tm.mode == "none":
                raise CommandError("There’s no timer on this slide.")
            t = now()
            if tm.ends_at is not None:
                tm.remaining, tm.ends_at = tm.left(t), None
            else:
                if tm.done or tm.remaining <= 0:
                    tm.remaining, tm.done = tm.total, False
                tm.ends_at = t + tm.remaining
            return None
        if cmd == "timer_start":  # the TV's automatic start; does nothing if already used
            tm = st.timer
            if tm.mode != "none" and tm.ends_at is None and not tm.done and tm.remaining >= tm.total:
                tm.ends_at = now() + tm.remaining
            return None
        if cmd == "break_adjust":
            if s.type != "halftime":
                raise CommandError("Only the half-time break can be changed.")
            delta = 60 if a.get("minutes", 0) > 0 else -60
            tm, t = st.timer, now()
            new_total = max(60, tm.total + delta)
            diff = new_total - tm.total
            tm.total = new_total
            if tm.ends_at is not None:
                tm.ends_at += diff
            else:
                tm.remaining = max(0, tm.remaining + diff)
            if tm.left(t) > 0:
                tm.done = False
            return None
        if cmd == "hint":
            q = self.question(qk_of(s)) if s.type == "question" else None
            if not getattr(q, "hint", None):
                raise CommandError("This question has no hint.")
            st.hint = not st.hint
            return {"effect": "hint", "on": st.hint}

        if cmd == "mark":
            qk, team = a.get("qk"), self.team(a.get("team"))
            if not self.valid_qk(qk):
                raise CommandError("Unknown question.")
            pts = a.get("pts")
            if pts is not None and (not isinstance(pts, int) or not 0 <= pts <= self.max_pts(qk)):
                raise CommandError("Bad mark.")
            self._set_mark(qk, team.id, pts, "host")
            return None
        if cmd == "auto_mark":
            qk = qk_of(s)
            if s.type != "answer":
                raise CommandError("Auto-marking works on answer slides.")
            q, marked = self.question(qk), 0
            for team in st.teams.values():
                if not team.token_hash or team.id in st.marks.get(qk, {}):
                    continue
                ans = st.answers.get(qk, {}).get(team.id)
                sg = suggest(q, ans.a if ans else "", ans.b if ans else "")
                if sg.level in ("match", "blank"):
                    self._set_mark(qk, team.id, sg.pts, "auto")
                    marked += 1
            return {"effect": "toast", "text": f"Marked {marked} answer{'s' if marked != 1 else ''}. Check the rest yourself." if marked else "Nothing obvious left to mark."}

        if cmd in ("dispute_show", "dispute_later", "dispute_rule"):
            key = a.get("key")
            if not isinstance(key, str) or "|" not in key:
                raise CommandError("Unknown dispute.")
            qk, tid = key.split("|", 1)
            d = st.disputes.get(qk, {}).get(tid)
            if d is None or d.status != "open":
                raise CommandError("That dispute has already been settled.")
            if cmd == "dispute_later":
                if key not in st.parked:
                    st.parked.append(key)
                if st.theatre and st.theatre.key == key and st.theatre.phase == "showing":
                    st.theatre = None
                return None
            if st.theatre and st.theatre.key != key and st.theatre.phase != "showing":
                raise CommandError("Finish the current ruling first.")
            if key in st.parked:
                st.parked.remove(key)
            if cmd == "dispute_show":
                st.theatre = Theatre(key=key)
                return None
            pts = a.get("pts")
            if not isinstance(pts, int) or not 0 <= pts <= self.max_pts(qk):
                raise CommandError("Bad mark.")
            st.theatre = Theatre(key=key, phase="deliberating", pts=pts, until=now() + DELIBERATE)
            return None

        if cmd == "team_add":
            self._add_team(a.get("name"), token=None)
            return None
        if cmd == "team_update":
            team = self.team(a.get("team"))
            if "name" in a:
                name = _clean_name(a.get("name"), 30)
                if not name or moderation.is_offensive(name):
                    raise CommandError("Pick a different name.")
                if any(t.name.lower() == name.lower() and t.id != team.id for t in st.teams.values()):
                    raise CommandError("Another team already has that name.")
                team.name = name
            if "joker" in a:
                j = a["joker"]
                if not isinstance(j, int) or not -1 <= j < len(self.quiz.rounds):
                    raise CommandError("Bad joker round.")
                team.joker = j
            if "adj" in a:
                team.adj = _number(a["adj"], -1000, 1000)
            if "manual" in a:
                m = a["manual"]
                r = m.get("round") if isinstance(m, dict) else None
                if not isinstance(r, int) or not 0 <= r < len(self.quiz.rounds):
                    raise CommandError("Bad round.")
                if m.get("points") in (None, ""):
                    team.manual.pop(r, None)
                else:
                    team.manual[r] = _number(m["points"], -1000, 1000)
            return None
        if cmd == "team_remove":
            self._remove_teams([self.team(a.get("team")).id])
            return {"effect": "kick", "teams": [a.get("team")]}
        if cmd == "teams_clear":
            ids = list(st.teams)
            self._remove_teams(ids)
            keep = State(settings=st.settings, index=st.index, revealed=st.revealed, timer=st.timer)
            self.st = keep
            return {"effect": "kick", "teams": ids}

        if cmd == "settings":
            se = st.settings
            if "quiz_name" in a:
                se.quiz_name = _clean_name(a["quiz_name"], 40) or self.quiz.title
            if "seconds" in a:
                se.seconds = int(_number(a["seconds"], 10, 180))
                if s.type in TIMED and st.timer.ends_at is None and st.timer.remaining >= st.timer.total:
                    st.timer = Timer(mode="q", total=se.seconds, remaining=se.seconds)
            if "break_minutes" in a:
                se.break_minutes = int(_number(a["break_minutes"], 1, 30))
            for k in ("auto_read", "auto_timer"):
                if k in a:
                    setattr(se, k, bool(a[k]))
            return None

        if cmd in ("tune", "read", "lounge", "mute", "fullscreen", "close_panels"):  # things only the TV can do
            return {"effect": cmd}
        if cmd == "volume":
            try:
                level = min(1.0, max(0.0, float(a.get("value"))))
            except (TypeError, ValueError):
                raise CommandError("Volume must be a number from 0 to 1.") from None
            return {"effect": "volume", "value": level}
        if cmd == "tv_status":  # the TV reporting its own sound status for the remote
            self.tv = {k: bool(a.get(k)) for k in ("soundReady", "playing", "muted", "lounge")}
            vol = a.get("volume")
            self.tv["volume"] = min(1.0, max(0.0, float(vol))) if isinstance(vol, (int, float)) else 0.7
            return None
        raise CommandError("Unknown command.")

    # ======================================================================
    # Teams
    # ======================================================================
    def _add_team(self, name_in: Any, token: str | None) -> Team:
        name = _clean_name(name_in, 30)
        if not name:
            raise CommandError("Pick a team name.")
        if moderation.is_offensive(name):
            raise CommandError("Let’s keep it friendly. Try another team name.")
        if any(t.name.lower() == name.lower() for t in self.st.teams.values()):
            raise CommandError("That name is taken. Try another one.")
        if len(self.st.teams) >= MAX_TEAMS:
            raise CommandError("This game is full.")
        team = Team(id=secrets.token_hex(4), name=name, token_hash=hash_token(token) if token else None)
        self.st.teams[team.id] = team
        return team

    def join(self, name: Any) -> tuple[Team, str]:
        token = secrets.token_urlsafe(24)
        return self._add_team(name, token), token

    def _remove_teams(self, ids: list[str]) -> None:
        st = self.st
        for tid in ids:
            st.teams.pop(tid, None)
            for table in (st.answers, st.marks, st.disputes):
                for by in table.values():
                    by.pop(tid, None)
            for pairs in st.pairings.values():
                pairs.pop(tid, None)
                for k in [k for k, v in pairs.items() if v == tid]:
                    del pairs[k]
            st.parked = [k for k in st.parked if not k.endswith("|" + tid)]
            if st.theatre and st.theatre.key.endswith("|" + tid):
                st.theatre = None
        self._show_next_dispute()

    def player_command(self, team: Team, cmd: str, a: dict[str, Any]) -> None:
        self.advance()
        st = self.st
        if cmd == "answer":
            qk = a.get("qk")
            if not self.valid_qk(qk) or qk not in self.open_qks():
                raise CommandError("Answers for that question are locked.")
            text_a, text_b = _clean_text(a.get("a"), 120), _clean_text(a.get("b"), 120)
            by = st.answers.setdefault(qk, {})
            if text_a or text_b:
                by[team.id] = Answer(a=text_a, b=text_b)
            else:
                by.pop(team.id, None)
            return
        if cmd == "joker":
            s, r = self.slide, a.get("round")
            if s.type != "round" or r != s.r:
                raise CommandError("Jokers can only be played on the round intro screen.")
            if 0 <= team.joker < r:
                raise CommandError("You already used your joker.")
            team.joker = -1 if team.joker == r else r
            return
        if cmd == "peer_mark":
            qk = a.get("qk")
            if not self.valid_qk(qk) or qk.startswith("tb-"):
                raise CommandError("Bad question.")
            target = st.pairings.get(int(qk.split("-")[0]), {}).get(team.id)
            if not target or target not in st.teams:
                raise CommandError("You’re not marking this one.")
            if qk not in st.revealed_keys:
                raise CommandError("Wait for the answer to be revealed.")
            existing = st.marks.get(qk, {}).get(target)
            if existing and existing.src == "host":
                raise CommandError("The quizmaster already ruled on this one.")
            if target in st.disputes.get(qk, {}):
                raise CommandError("This mark is under dispute. The quizmaster decides now.")
            pts = a.get("pts")
            if pts is not None and (not isinstance(pts, int) or not 0 <= pts <= self.max_pts(qk)):
                raise CommandError("Bad mark.")
            self._set_mark(qk, target, pts, "peer")
            return
        if cmd == "dispute":
            qk = a.get("qk")
            if not self.valid_qk(qk):
                raise CommandError("Bad question.")
            mark = st.marks.get(qk, {}).get(team.id)
            if mark is None or qk not in st.revealed_keys:
                raise CommandError("Nothing to dispute yet.")
            if mark.src == "host":
                raise CommandError("The quizmaster already ruled. Their decision is final!")
            if team.id in st.disputes.get(qk, {}):
                raise CommandError("You already disputed this one.")
            st.disputes.setdefault(qk, {})[team.id] = Dispute(reason=moderation.clean(_clean_text(a.get("reason"), 100)), from_pts=mark.pts)
            self._show_next_dispute()
            return
        raise CommandError("Unknown action.")

    # ======================================================================
    # What each screen sees
    # ======================================================================
    def _timer_view(self) -> dict[str, Any]:
        tm = self.st.timer
        return {"mode": tm.mode, "total": tm.total, "remaining": tm.remaining, "endsAt": tm.ends_at * 1000 if tm.ends_at else None,
                "running": tm.ends_at is not None, "done": tm.done}

    def public_question(self, qk: str, with_hint: bool = False) -> dict[str, Any]:
        """A question as the teams see it: no answers."""
        if qk.startswith("tb-"):
            ti = int(qk[3:])
            tb = self.quiz.tiebreakers[ti]
            return {"qk": qk, "n": ti + 1, "label": f"Tiebreaker {ti + 1} of {len(self.quiz.tiebreakers)}", "icon": tb.icon, "text": tb.q, "input": "number"}
        r, qi = (int(x) for x in qk.split("-"))
        rnd, q = self.quiz.rounds[r], self.quiz.rounds[r].questions[qi]
        o: dict[str, Any] = {"qk": qk, "r": r, "n": qi + 1, "label": f"Question {qi + 1} of {len(rnd.questions)}",
                             "input": "ab" if rnd.kind == "versus" else "music" if rnd.kind == "music" else "text"}
        if isinstance(q, MusicQ) and q.tune is not None:
            o.update(icon="🎵", text=f"Track {qi + 1}: listen to the tune on the big screen.", bLabel="Composer")
        elif isinstance(q, FlagQ) and q.flag:
            o.update(flag=q.flag, text="Which country’s flag is this?")
        elif isinstance(q, VowelsQ):
            o.update(cat=q.cat, clue=q.clue, text="Put the vowels back to find the answer.")
        elif isinstance(q, VersusQ):
            o.update(text="Which came first?", A={"icon": q.A.icon, "text": q.A.text}, B={"icon": q.B.icon, "text": q.B.text})
        elif getattr(q, "emoji", None):
            o.update(emoji=q.emoji, text=getattr(q, "q", None) or rnd.prompt or "")
        else:
            o.update(icon=getattr(q, "icon", None), text=q.q)
        if with_hint and getattr(q, "hint", None):
            o["hint"] = q.hint
        return {k: v for k, v in o.items() if v is not None}

    def answer_key(self, qk: str) -> dict[str, Any]:
        q = self.question(qk)
        if isinstance(q, VersusQ):
            side = q.A if q.first == "a" else q.B
            return {"a": f"{q.first.upper()}: {side.text} ({side.date})", "sub": "", "note": q.mark or ""}
        return {"a": q.a, "sub": getattr(q, "by", None) or "", "note": getattr(q, "mark", None) or ""}

    def _answer_text(self, qk: str, ans: Answer | None) -> str:
        if not ans or not (ans.a or ans.b):
            return ""
        q = self.question(qk)
        if isinstance(q, VersusQ):
            side = q.A if ans.a.lower() == "a" else q.B if ans.a.lower() == "b" else None
            return f"{ans.a}: {side.text}" if side else ans.a
        return ans.a + (f" · {ans.b}" if ans.b else "")

    def _summary(self, qk: str) -> str:
        info = self.public_question(qk)
        if info.get("cat"):
            return f"{info['cat']}: {info['clue']}"
        if info.get("input") == "ab":
            return f"Which came first? A: {info['A']['text']} or B: {info['B']['text']}"
        if info.get("emoji"):
            return f"{info['emoji']}  {info.get('text', '')}".strip()
        return info.get("text", "")

    def _marker_of(self, r: int, team_id: str) -> str | None:
        return next((m for m, t in self.st.pairings.get(r, {}).items() if t == team_id), None)

    def dispute_facts(self, qk: str, team_id: str) -> dict[str, Any]:
        d = self.st.disputes[qk][team_id]
        r = None if qk.startswith("tb-") else int(qk.split("-")[0])
        marker = self._marker_of(r, team_id) if r is not None else None
        key = self.answer_key(qk)
        return {"key": f"{qk}|{team_id}", "qk": qk, "team": team_id, "teamName": self.st.teams[team_id].name,
                "marker": marker, "markerName": self.st.teams[marker].name if marker in self.st.teams else None,
                "question": self._summary(qk), "round": r, "n": int(qk.split("-")[-1]) + 1,
                "theirs": self._answer_text(qk, self.st.answers.get(qk, {}).get(team_id)) or "No answer",
                "correct": key["a"] + (f" · {key['sub']}" if key["sub"] else ""), "note": key["note"],
                "reason": d.reason, "from": d.from_pts, "max": self.max_pts(qk)}

    def host_view(self, online: set[str], tv_online: bool = False) -> dict[str, Any]:
        """Everything, for the quizmaster's TV and phone."""
        st, s = self.st, self.slide
        ranks = {row["id"]: row["rank"] for row in self.ranked()}
        teams = [{"id": t.id, "name": t.name, "phone": t.token_hash is not None, "online": t.id in online,
                  "joker": t.joker, "adj": t.adj, "manual": {str(k): v for k, v in t.manual.items()},
                  "rounds": [self.round_score(t, r) for r in range(len(self.quiz.rounds))],
                  "total": self.total(t), "rank": ranks.get(t.id, 0)} for t in st.teams.values()]
        current = None
        qk = qk_of(s)
        if qk:
            q, rows = self.question(qk), []
            target = None
            if qk.startswith("tb-"):
                try:
                    target = float(q.a.replace(",", "").split()[0])
                except ValueError:
                    target = None
            for t in st.teams.values():
                ans = st.answers.get(qk, {}).get(t.id)
                mark = st.marks.get(qk, {}).get(t.id)
                d = st.disputes.get(qk, {}).get(t.id)
                row: dict[str, Any] = {"team": t.id, "answer": self._answer_text(qk, ans), "raw": ans.model_dump(exclude={"at"}) if ans else None,
                                       "mark": mark.pts if mark else None, "src": mark.src if mark else None,
                                       "dispute": d.status if d else None}
                if s.type == "answer":
                    sg = suggest(q, ans.a if ans else "", ans.b if ans else "")
                    row["suggest"] = {"level": sg.level, "pts": sg.pts} if sg.level in ("match", "close") else None
                    row["warn"] = bool(mark and mark.src != "host" and sg.level == "match" and sg.pts != mark.pts)
                    marker = self._marker_of(s.r, t.id)
                    row["marker"] = marker
                if target is not None and ans:
                    try:
                        row["off"] = abs(float(ans.a.replace(",", "").strip()) - target)
                    except ValueError:
                        row["off"] = None
                rows.append(row)
            current = {"qk": qk, "rows": rows, "max": self.max_pts(qk)}
        theatre = None
        if st.theatre:
            qk_t, tid = st.theatre.key.split("|", 1)
            if tid in st.teams:
                theatre = {**self.dispute_facts(qk_t, tid), "phase": st.theatre.phase, "pts": st.theatre.pts, "verdict": st.theatre.verdict}
        return {
            "index": st.index, "slide": s.as_dict(), "revealed": st.revealed, "hint": st.hint, "rolling": st.rolling_until is not None,
            "timer": self._timer_view(), "settings": st.settings.model_dump(), "teams": teams,
            "current": current, "pairings": st.pairings.get(s.r, {}) if s.r is not None else {},
            "disputes": [self.dispute_facts(qk_d, tid) for qk_d, tid, _ in self.open_disputes()],
            "theatre": theatre, "parked": st.parked, "tv": {**self.tv, "online": tv_online}, "serverTime": now() * 1000,
        }

    def player_view(self, team: Team) -> dict[str, Any]:
        """Only what a team may see."""
        st, s = self.st, self.slide
        open_qks = self.open_qks()
        slide: dict[str, Any] = {**s.as_dict(), "index": st.index, "revealed": st.revealed,
                                 "quizName": st.settings.quiz_name, "rounds": len(self.quiz.rounds), "timer": self._timer_view() if s.type in TIMED else None}
        if s.type == "round":
            rnd = self.quiz.rounds[s.r]
            slide["round"] = {"title": rnd.title, "icon": rnd.icon, "blurb": rnd.blurb, "scoring": rnd.scoring}
        qk = qk_of(s)
        if qk:
            slide["question"] = self.public_question(qk, with_hint=s.type == "question" and st.hint)
        if s.type in ("standings", "end") or (s.type == "winner" and st.revealed):
            slide["standings"] = [{**row, "total": _fmt(row["total"])} for row in self.ranked()]

        def in_sheet(k: str) -> bool:
            if s.type == "tb":
                return k.startswith("tb-") and (k == qk or k in open_qks)
            return s.r is not None and not k.startswith("tb-") and int(k.split("-")[0]) == s.r

        sheet = []
        for k in sorted((k for k in st.seen if in_sheet(k)), key=lambda k: int(k.split("-")[-1])):
            ans, revealed = st.answers.get(k, {}).get(team.id), k in st.revealed_keys
            mark = st.marks.get(k, {}).get(team.id)
            sheet.append({"qk": k, "info": self.public_question(k), "my": ans.model_dump(exclude={"at"}) if ans else None, "open": k in open_qks,
                          "key": self.answer_key(k) if revealed else None,
                          "mark": mark.pts if revealed and mark else None, "src": mark.src if revealed and mark else None,
                          "dispute": _dispute_public(st.disputes.get(k, {}).get(team.id))})
        pairs = st.pairings.get(s.r, {}) if s.r is not None and s.type != "tb" else {}
        target = pairs.get(team.id) if pairs.get(team.id) in st.teams else None
        marker = self._marker_of(s.r, team.id) if pairs else None
        mark_sheet = []
        if target:
            for k in sorted((k for k in st.revealed_keys if not k.startswith("tb-") and int(k.split("-")[0]) == s.r), key=lambda k: int(k.split("-")[1])):
                mark = st.marks.get(k, {}).get(target)
                mark_sheet.append({"qk": k, "info": self.public_question(k), "key": self.answer_key(k),
                                   "their": self._answer_text(k, st.answers.get(k, {}).get(target)) or None, "max": self.max_pts(k),
                                   "mark": mark.pts if mark else None, "src": mark.src if mark else None,
                                   "dispute": _dispute_public(st.disputes.get(k, {}).get(target))})
        return {
            "me": {"id": team.id, "name": team.name, "joker": team.joker,
                   "marking": {"id": target, "name": st.teams[target].name} if target else None,
                   "markedBy": st.teams[marker].name if marker in st.teams else None},
            "slide": slide, "sheet": sheet, "markSheet": mark_sheet, "serverTime": now() * 1000,
        }


# ---------- small helpers ----------

def _dispute_public(d: Dispute | None) -> dict[str, Any] | None:
    return {"status": d.status} if d else None


def _clean_text(v: Any, max_len: int) -> str:
    s = "" if v is None else str(v)
    s = "".join(ch if ch.isprintable() else " " for ch in s)
    return " ".join(s.split())[:max_len]


def _clean_name(v: Any, max_len: int) -> str:
    return _clean_text(v, max_len)


def _number(v: Any, lo: float, hi: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise CommandError("That needs to be a number.") from None
    if x != x or not lo <= x <= hi:
        raise CommandError(f"That needs to be between {lo:g} and {hi:g}.")
    return round(x * 2) / 2  # half points at most


def _fmt(x: float) -> str:
    return f"{x:g}"

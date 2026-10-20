"""The shapes of what the server sends each screen, as Pydantic models.

`Game.host_view()` and `Game.player_view()` build plain dicts (cheap, sent many times a second);
these models are the contract they must match. tests/test_views.py plays whole games and checks
every view against them (unknown fields fail), and the frontend's TypeScript types are generated
from them by `npm run gen:types`, so the server and the screens can't drift apart.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SlideType = Literal["title", "rules", "round", "question", "swap", "answer", "standings", "halftime", "tbIntro", "tb", "winner", "end"]
MarkSource = Literal["peer", "auto", "host"]
DisputeStatus = Literal["open", "upheld", "overturned"]


class View(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Slide(View):
    type: SlideType
    r: int | None = None
    q: int | None = None
    t: int | None = None


class TimerView(View):
    mode: Literal["none", "q", "break"]
    total: float
    remaining: float
    endsAt: float | None  # server clock, milliseconds
    running: bool
    done: bool


class GameSettings(View):
    quiz_name: str
    seconds: int
    break_minutes: int
    auto_read: bool
    auto_timer: bool


# ---------- The quizmaster's screens (TV and remote) ----------

class TeamRow(View):
    id: str
    name: str
    phone: bool                      # False: added by the quizmaster, plays on paper
    online: bool
    joker: int
    adj: float
    manual: dict[str, float]
    rounds: list[float | None]
    total: float
    rank: int


class AnswerPair(View):
    a: str
    b: str


class Suggestion(View):
    level: Literal["match", "close"]
    pts: int


class AnswerRow(View):
    team: str
    answer: str
    raw: AnswerPair | None
    mark: int | None
    src: MarkSource | None
    dispute: DisputeStatus | None
    suggest: Suggestion | None = None   # answer slides only
    warn: bool | None = None            # answer slides only
    marker: str | None = None           # answer slides only
    off: float | None = None            # tiebreakers only


class CurrentQuestion(View):
    qk: str
    rows: list[AnswerRow]
    max: int


class DisputeFacts(View):
    key: str
    qk: str
    team: str
    teamName: str
    marker: str | None
    markerName: str | None
    question: str
    round: int | None
    n: int
    theirs: str
    correct: str
    note: str
    reason: str
    from_: int = Field(alias="from")  # the mark being disputed ("from" is a Python keyword)
    max: int


class Theatre(DisputeFacts):
    phase: Literal["showing", "deliberating", "verdict"]
    pts: int | None
    verdict: Literal["upheld", "overturned"] | None


class TvStatus(View):
    online: bool
    soundReady: bool | None = None
    playing: bool | None = None
    muted: bool | None = None
    lounge: bool | None = None
    volume: float | None = None


class HostView(View):
    index: int
    slide: Slide
    revealed: bool
    hint: bool
    rolling: bool
    timer: TimerView
    settings: GameSettings
    teams: list[TeamRow]
    current: CurrentQuestion | None
    pairings: dict[str, str]
    disputes: list[DisputeFacts]
    theatre: Theatre | None
    parked: list[str]
    tv: TvStatus
    serverTime: float


# ---------- A team's phone ----------

class VersusSide(View):
    icon: str | None = None
    text: str


class PublicQuestion(View):
    qk: str
    n: int
    label: str
    input: Literal["text", "music", "ab", "number"]
    r: int | None = None
    icon: str | None = None
    text: str | None = None
    emoji: str | None = None
    flag: str | None = None
    cat: str | None = None
    clue: str | None = None
    hint: str | None = None
    bLabel: str | None = None
    A: VersusSide | None = None
    B: VersusSide | None = None


class AnswerKey(View):
    a: str
    sub: str
    note: str


class DisputeBadge(View):
    status: DisputeStatus


class SheetItem(View):
    qk: str
    info: PublicQuestion
    my: AnswerPair | None
    open: bool
    key: AnswerKey | None
    mark: int | None
    src: MarkSource | None
    dispute: DisputeBadge | None


class MarkItem(View):
    qk: str
    info: PublicQuestion
    key: AnswerKey
    their: str | None
    max: int
    mark: int | None
    src: MarkSource | None
    dispute: DisputeBadge | None


class Standing(View):
    id: str
    name: str
    total: str
    rank: int


class RoundInfo(View):
    title: str
    icon: str | None = None
    blurb: str | None = None
    scoring: str | None = None


class PlayerSlide(Slide):
    index: int
    revealed: bool
    quizName: str
    rounds: int
    timer: TimerView | None
    round: RoundInfo | None = None
    question: PublicQuestion | None = None
    standings: list[Standing] | None = None


class TeamRef(View):
    id: str
    name: str


class Me(View):
    id: str
    name: str
    joker: int
    marking: TeamRef | None
    markedBy: str | None


class PlayerView(View):
    me: Me
    slide: PlayerSlide
    sheet: list[SheetItem]
    markSheet: list[MarkItem]
    serverTime: float


class RoomInfo(View):
    code: str
    joinUrl: str
    siteUrl: str

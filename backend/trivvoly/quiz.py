"""Quiz file format, version 1: the single source of truth for what a quiz may contain.

Every quiz (built-in, uploaded, later saved from the builder) is validated here before use.
Unknown fields are dropped, text is trimmed and length-limited, lists are capped, and each
round kind has its own required fields. Text is still escaped wherever it is displayed.
"""
from __future__ import annotations

import re
from typing import Annotated, Any, Literal, Union

import regex
from pydantic import (AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field,
                      StringConstraints, ValidationError, model_validator)

from .flags import FLAGS

KINDS = ("standard", "flag", "music", "emoji", "vowels", "versus")
INSTRUMENTS = ("strings", "organ", "brass", "piano", "pluck")
MAX_ICON_CHARS = 2  # an emoji or two; "🐻‍❄️" counts as one
NOTE = re.compile(r"^(R|[A-G][#b]?-?\d)(:\d+(\.\d+)?)?$")
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean(v: Any) -> Any:
    """Numbers become text; text loses control characters and outer spaces; blanks become None."""
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        v = str(v)
    if isinstance(v, str):
        v = CONTROL_CHARS.sub("", v).strip()
        return v or None
    return v


def text(max_len: int) -> Any:
    return Annotated[str, BeforeValidator(_clean), StringConstraints(max_length=max_len)]


def _icon(v: str | None) -> str | None:
    if v is not None and len(regex.findall(r"\X", v)) > MAX_ICON_CHARS:
        raise ValueError(f"must be an emoji or two (max {MAX_ICON_CHARS} characters)")
    return v


Icon = Annotated[str | None, BeforeValidator(_clean), StringConstraints(max_length=16), AfterValidator(_icon)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


# ---------- Questions (one model per round kind) ----------

class Common(Strict):
    a: text(120)
    fact: text(400) | None = None
    mark: text(240) | None = None
    say: text(160) | None = None


class StandardQ(Common):
    kind: Literal["standard"]
    icon: Icon = None
    q: text(300)


class FlagQ(Common):
    kind: Literal["flag"]
    flag: str | None = None
    emoji: text(60) | None = None
    q: text(300) | None = None

    @model_validator(mode="after")
    def _flag_or_clue(self) -> FlagQ:
        if self.flag is not None:
            if self.flag not in FLAGS:
                raise ValueError(f"flag must be a built-in flag id ({', '.join(FLAGS)})")
        elif not (self.emoji and self.q):
            raise ValueError("needs either a built-in flag, or emoji plus a question")
        return self


class MusicQ(Common):
    kind: Literal["music"]
    tune: int | None = Field(default=None, ge=0, le=99)
    emoji: text(60) | None = None
    by: text(80)
    year: text(12) | None = None
    hint: text(160) | None = None

    @model_validator(mode="after")
    def _tune_or_emoji(self) -> MusicQ:
        if self.tune is None and not self.emoji:
            raise ValueError("needs either a tune or emoji clues")
        return self


class EmojiQ(Common):
    kind: Literal["emoji"]
    emoji: text(60)
    q: text(300) | None = None
    year: text(12) | None = None
    hint: text(160) | None = None


def _clue(v: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9 ]+", v):
        raise ValueError("may only use letters, digits and spaces")
    return re.sub(r"\s+", " ", v.upper())


class VowelsQ(Common):
    kind: Literal["vowels"]
    cat: text(40)
    clue: Annotated[text(60), AfterValidator(_clue)]


class Side(Strict):
    icon: Icon = None
    text: text(160)
    date: text(40)


class VersusQ(Strict):
    kind: Literal["versus"]
    A: Side
    B: Side
    first: Literal["a", "b"]
    fact: text(400) | None = None
    mark: text(240) | None = None
    say: text(160) | None = None


Question = Annotated[Union[StandardQ, FlagQ, MusicQ, EmojiQ, VowelsQ, VersusQ], Field(discriminator="kind")]


# ---------- Rounds, tiebreakers, tunes, the quiz ----------

class Round(Strict):
    title: text(40)
    icon: Icon = None
    kind: Literal[KINDS]  # type: ignore[valid-type]
    blurb: text(300) | None = None
    scoring: text(160) | None = None
    prompt: text(160) | None = None
    questions: list[Question] = Field(min_length=1, max_length=30)

    @model_validator(mode="before")
    @classmethod
    def _tag_questions(cls, data: Any) -> Any:
        # Each question is validated by its round's kind
        if isinstance(data, dict) and isinstance(data.get("questions"), list) and data.get("kind") in KINDS:
            data = {**data, "questions": [{**q, "kind": data["kind"]} if isinstance(q, dict) else q for q in data["questions"]]}
        return data


def _tb_answer(v: str) -> str:
    if not re.search(r"\d", v):
        raise ValueError("must contain a number (closest answer wins)")
    return v


class Tiebreaker(Strict):
    icon: Icon = None
    q: text(300)
    a: Annotated[text(60), AfterValidator(_tb_answer)]
    say: text(160) | None = None
    fact: text(400) | None = None


def _notes(v: str) -> str:
    tokens = v.split()
    if len(tokens) > 600:
        raise ValueError("has too many notes (max 600)")
    for tok in tokens:
        if not NOTE.match(tok):
            raise ValueError(f'has an invalid note "{tok[:12]}" (use e.g. C4:2, F#3:1 or R:1)')
    return v


class Tune(Strict):
    inst: Literal[INSTRUMENTS]  # type: ignore[valid-type]
    unit: float = Field(ge=0.03, le=1)
    transpose: int | None = Field(default=None, ge=-36, le=36)
    double: int | None = Field(default=None, ge=-36, le=36)
    notes: Annotated[text(3000), AfterValidator(_notes)]


class Rule(Strict):
    icon: Icon = None
    text: text(200)


class Quiz(Strict):
    format: Literal[1] = 1
    title: text(40)
    rules: list[Rule] = Field(default_factory=list, max_length=10)
    rounds: list[Round] = Field(min_length=1, max_length=12)
    tiebreakers: list[Tiebreaker] = Field(default_factory=list, max_length=5)
    tunes: list[Tune] = Field(default_factory=list, max_length=20)
    halftimeAfter: int = -1

    @model_validator(mode="after")
    def _cross_checks(self) -> Quiz:
        if self.halftimeAfter != -1 and not 0 <= self.halftimeAfter <= len(self.rounds) - 2:
            raise ValueError(f"quiz.halftimeAfter must be -1 (no half-time) or a round number from 0 to {len(self.rounds) - 2}")
        for ri, r in enumerate(self.rounds):
            for qi, q in enumerate(r.questions):
                if isinstance(q, MusicQ) and q.tune is not None and q.tune >= len(self.tunes):
                    raise ValueError(f"quiz.rounds[{ri}].questions[{qi}].tune must point at one of the quiz's tunes (0 to {len(self.tunes) - 1})")
        return self

    def public_dict(self) -> dict[str, Any]:
        """The quiz as sent to the quizmaster's screens. Each question keeps its round's `kind`
        so the frontend's generated types can tell question types apart."""
        return self.model_dump(exclude_none=True)

    def file_dict(self) -> dict[str, Any]:
        """The quiz in the file format (as in quizzes/*.json): questions without the internal kind tag."""
        d = self.model_dump(exclude_none=True)
        for r in d["rounds"]:
            for q in r["questions"]:
                q.pop("kind", None)
        return d

    @property
    def question_count(self) -> int:
        return sum(len(r.questions) for r in self.rounds)


# ---------- Friendly errors ----------

_KIND_TAGS = {f"{k}" for k in KINDS}


def _where(loc: tuple[Any, ...]) -> str:
    out = "quiz"
    for part in loc:
        if isinstance(part, int):
            out += f"[{part}]"
        elif part in _KIND_TAGS or str(part).startswith("function-"):
            continue  # internal tags, not the author's field names
        else:
            out += f".{part}"
    return out


def _message(err: dict[str, Any]) -> str:
    t, ctx = err["type"], err.get("ctx") or {}
    if t == "missing":
        return "is required"
    if t == "string_too_long":
        return f"is too long (max {ctx.get('max_length')} characters)"
    if t == "too_long":
        unit = "characters" if isinstance(err.get("input"), str) else "items"
        return f"is too long (max {ctx.get('max_length')} {unit})" if unit == "characters" else f"has too many items (max {ctx.get('max_length')})"
    if t == "too_short":
        return f"needs at least {ctx.get('min_length')}"
    if t == "literal_error":
        return f"must be one of: {ctx.get('expected', '').replace(chr(39), '')}"
    if t in ("string_type", "str_type"):
        return "is required" if err.get("input") is None else "must be text"
    if t in ("list_type",):
        return "must be a list"
    if t in ("model_type", "dict_type", "model_attributes_type"):
        return "must be an object"
    if t in ("int_type", "int_parsing", "int_from_float"):
        return "must be a whole number"
    if t.startswith("greater_than") or t.startswith("less_than"):
        return err["msg"].replace("Input should be", "must be")
    if t == "value_error":
        return err["msg"].removeprefix("Value error, ")
    return err["msg"]


def validate_quiz(data: Any) -> tuple[Quiz | None, list[str]]:
    """Returns (quiz, []) or (None, problems) with readable paths like quiz.rounds[2].questions[4].a."""
    if not isinstance(data, dict):
        return None, ["quiz must be a JSON object"]
    try:
        return Quiz.model_validate(data), []
    except ValidationError as e:
        problems = []
        for err in e.errors()[:50]:
            if err["type"] in ("union_tag_not_found", "union_tag_invalid"):
                continue  # already reported as a bad round kind
            msg = _message(err)
            where = _where(err["loc"])
            problems.append(msg if msg.startswith("quiz.") else f"{where} {msg}")
        return None, problems

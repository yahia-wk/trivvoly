"""Suggestions for marking answers: 'match' is safe to auto-mark, 'close' is worth a look.

Spelling doesn't count in a pub quiz, so answers are compared loosely: accents, punctuation,
"the/a/an" and small typos are ignored, and number words count as digits.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from .quiz import MusicQ, Question, VersusQ

NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
             "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]
QUOTED = re.compile(r"“([^”]+)”")

Level = Literal["match", "close", "blank"]


def norm(v: str | None) -> str:
    s = unicodedata.normalize("NFD", v or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s = re.sub(r"[−–-](?=\s*\d)", " minus ", s)
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\b(the|a|an)\b", " ", s)
    s = re.sub(r"\b[a-z]+\b", lambda m: str(NUM_WORDS.index(m.group())) if m.group() in NUM_WORDS else m.group(), s)
    return re.sub(r"\s+", " ", s).strip()


def lev(a: str, b: str) -> int:
    if abs(len(a) - len(b)) > 3:
        return 99
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i]
        for j in range(1, len(b) + 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1])))
        prev = cur
    return prev[len(b)]


def similar(ans: str | None, correct: str | None) -> Literal["match", "close"] | None:
    a, c = norm(ans), norm(correct)
    if not a or not c:
        return None
    if a == c:
        return "match"
    if len(c) >= 5 and lev(a, c) <= (2 if len(c) >= 10 else 1):
        return "match"
    if len(a) >= 4 and (f" {a} " in f" {c} " or f" {c} " in f" {a} "):
        return "close"
    return None


def best(ans: str | None, candidates: list[str | None]) -> Literal["match", "close"] | None:
    levels = [similar(ans, c) for c in candidates if c]
    return "match" if "match" in levels else "close" if "close" in levels else None


@dataclass
class Suggestion:
    pts: int
    level: Level | None


def suggest(q: Question, a: str = "", b: str = "") -> Suggestion:
    """How an answer looks against the question's answer and its marking note."""
    if not (a or b):
        return Suggestion(0, "blank")
    alts = QUOTED.findall(getattr(q, "mark", None) or "")
    if isinstance(q, VersusQ):
        return Suggestion(1 if a.lower() == q.first else 0, "match")
    if isinstance(q, MusicQ):
        bonus_alts = alts if re.search("bonus", q.mark or "", re.I) else []
        title_alts = [] if bonus_alts else alts
        last = q.by.split(" ")[-1]
        tl = (best(a, [q.a, *title_alts]) or "none") if norm(a) else "blank"
        bl = (best(b, [q.by, *bonus_alts, last if len(last) >= 4 else None]) or "none") if norm(b) else "blank"
        pts = (tl == "match") + (bl == "match")
        sure = all(x in ("match", "blank") for x in (tl, bl))
        return Suggestion(pts, "match" if sure else "close" if any(x in ("match", "close") for x in (tl, bl)) else None)
    level = best(a, [q.a, *alts])
    return Suggestion(1 if level == "match" else 0, level)

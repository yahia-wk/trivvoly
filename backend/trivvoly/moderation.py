"""Text that players type and other people see.

Team names with offensive words are refused; dispute reasons (shown on the big screen) have
offensive words starred out. The English word list comes from the obscenity library (MIT, see
data/profanity_en.json; regenerate with scripts/export_profanity.js). Like that library, we
undo common disguises (accents, look-alike digits and symbols, stretched letters, spaced-out
letters) and ignore matches inside known innocent words.
"""
from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

_DATA = json.loads((Path(__file__).parent / "data" / "profanity_en.json").read_text(encoding="utf-8"))
_BLACKLIST = [re.compile(item["regex"]) for item in _DATA["blacklist"]]

# Innocent words the list trips over, on top of the dataset's own (kept short and specific)
ALLOWED = ["pussycat", "pussycats", "pussy willow", "dick fosbury", "moby dick", "dickens", "dick turpin",
           "dick van dyke", "cocktail", "cockatoo", "cockpit", "shitake", "shiitake", "scunthorpe", "penistone"]
_WHITELIST = sorted(set(_DATA["whitelist"]) | set(ALLOWED), key=len, reverse=True)

_LEET = str.maketrans({"4": "a", "@": "a", "3": "e", "1": "i", "!": "i", "|": "i", "0": "o",
                       "5": "s", "$": "s", "7": "t", "+": "t", "8": "b", "9": "g"})
_SPACED = re.compile(r"\b(\w)[\s._\-*]+(?=\w\b)")  # "f u c k" / "f.u.c.k" -> "fuck"


def _base(text: str) -> str:
    """Lower-case ASCII with accents removed and look-alike characters resolved."""
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_only = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return ascii_only.lower().translate(_LEET)


def _variants(text: str) -> set[str]:
    base = _base(text)
    out = set()
    for v in (base, re.sub(r"(.)\1{2,}", r"\1\1", base), re.sub(r"(.)\1+", r"\1", base)):
        out.add(v)
        out.add(_SPACED.sub(r"\1", v))
    return out


def _offensive_in(s: str) -> bool:
    allowed_spans = []
    for term in _WHITELIST:
        start = s.find(term)
        while start != -1:
            allowed_spans.append((start, start + len(term)))
            start = s.find(term, start + 1)
    for pattern in _BLACKLIST:
        for m in pattern.finditer(s):
            if not any(a <= m.start() and m.end() <= b for a, b in allowed_spans):
                return True
    return False


@lru_cache(maxsize=4096)
def is_offensive(text: str) -> bool:
    return any(_offensive_in(v) for v in _variants(text or ""))


def clean(text: str) -> str:
    """Star out offensive words; if the offence only shows across words, drop the text."""
    parts = re.split(r"(\s+)", text or "")
    changed = False
    for i, word in enumerate(parts):
        if word.strip() and is_offensive(word):
            parts[i] = "".join("&$%@"[k % 4] if ch.isalnum() else ch for k, ch in enumerate(word))
            changed = True
    result = "".join(parts)
    if not changed and is_offensive(result):
        return "(removed)"
    return result

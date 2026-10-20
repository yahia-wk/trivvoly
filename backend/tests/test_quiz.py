"""The quiz format: what a quiz may contain, and the messages authors get when it's wrong."""
import copy
import json
from pathlib import Path

from trivvoly.moderation import clean, is_offensive
from trivvoly.quiz import validate_quiz

CLASSIC = json.loads((Path(__file__).resolve().parents[2] / "quizzes" / "classic.json").read_text(encoding="utf-8"))


def tiny():
    return {"title": "Tiny quiz", "rounds": [{"title": "One", "kind": "standard", "questions": [{"q": "Two plus two?", "a": "4"}]}]}


def problems(d):
    return validate_quiz(d)[1]


def test_the_classic_quiz_is_valid_and_unchanged():
    quiz, errors = validate_quiz(CLASSIC)
    assert not errors
    assert quiz.question_count == 56 and len(quiz.rounds) == 7
    pub = quiz.public_dict()
    assert json.dumps(pub["rounds"], sort_keys=True) == json.dumps(CLASSIC["rounds"], sort_keys=True)
    assert pub["tiebreakers"] == CLASSIC["tiebreakers"] and pub["tunes"] == CLASSIC["tunes"]


def test_a_minimal_quiz_gets_defaults():
    quiz, errors = validate_quiz(tiny())
    assert not errors and quiz.rules == [] and quiz.tiebreakers == [] and quiz.halftimeAfter == -1


def test_unknown_fields_are_dropped_everywhere():
    d = tiny()
    d["onload"] = "alert(1)"
    d["rounds"][0]["html"] = "<b>x</b>"
    d["rounds"][0]["questions"][0]["svg"] = "<svg onload=alert(1)>"
    pub = validate_quiz(d)[0].public_dict()
    assert "onload" not in pub and "html" not in pub["rounds"][0]
    assert sorted(pub["rounds"][0]["questions"][0]) == ["a", "q"]


def test_flags_only_come_from_the_built_in_library():
    d = tiny()
    d["rounds"][0]["kind"] = "flag"
    d["rounds"][0]["questions"] = [{"flag": "<svg onload=alert(1)>", "a": "X"}]
    assert problems(d)
    d["rounds"][0]["questions"] = [{"flag": "estonia", "a": "Estonia"}]
    assert not problems(d)
    d["rounds"][0]["questions"] = [{"flag": "__class__", "a": "X"}]
    assert problems(d)


def test_text_is_trimmed_cleaned_and_limited():
    d = tiny()
    d["rounds"][0]["questions"][0]["q"] = "  Two\x00 plus\x07 two?  "
    assert validate_quiz(d)[0].rounds[0].questions[0].q == "Two plus two?"
    d["rounds"][0]["questions"][0]["q"] = "x" * 301
    assert problems(d) == ["quiz.rounds[0].questions[0].q is too long (max 300 characters)"]


def test_required_fields_per_round_kind():
    d = tiny()
    del d["rounds"][0]["questions"][0]["a"]
    assert problems(d) == ["quiz.rounds[0].questions[0].a is required"]
    vs = tiny()
    vs["rounds"][0]["kind"] = "versus"
    vs["rounds"][0]["questions"] = [{"A": {"text": "One", "date": "1900"}, "B": {"text": "Two", "date": "1901"}}]
    assert problems(vs) == ["quiz.rounds[0].questions[0].first is required"]
    vs["rounds"][0]["questions"][0]["first"] = "a"
    assert not problems(vs)
    mu = tiny()
    mu["rounds"][0]["kind"] = "music"
    mu["rounds"][0]["questions"] = [{"emoji": "🎵", "a": "Song"}]
    assert "quiz.rounds[0].questions[0].by is required" in problems(mu)


def test_bad_kinds_clues_tunes_and_tiebreakers():
    k = tiny()
    k["rounds"][0]["kind"] = "html"
    assert problems(k) == ["quiz.rounds[0].kind must be one of: standard, flag, music, emoji, vowels or versus"]
    v = tiny()
    v["rounds"][0]["kind"] = "vowels"
    v["rounds"][0]["questions"] = [{"cat": "Animals", "clue": "<script>", "a": "x"}]
    assert "letters, digits and spaces" in problems(v)[0]
    t = tiny()
    t["tunes"] = [{"inst": "brass", "unit": 0.2, "notes": "C4:1 <x>"}]
    assert "invalid note" in problems(t)[0]
    t["tunes"] = [{"inst": "kazoo", "unit": 0.2, "notes": "C4:1"}]
    assert "inst must be one of" in problems(t)[0]
    m = tiny()
    m["rounds"][0]["kind"] = "music"
    m["rounds"][0]["questions"] = [{"tune": 3, "a": "x", "by": "y"}]
    assert "tune must point at" in problems(m)[0]
    tb = tiny()
    tb["tiebreakers"] = [{"q": "How many?", "a": "lots"}]
    assert "must contain a number" in problems(tb)[0]


def test_icons_are_an_emoji_or_two():
    d = tiny()
    d["rounds"][0]["icon"] = "🐻‍❄️"
    assert not problems(d)
    d["rounds"][0]["icon"] = "<b>x</b>"
    assert "an emoji or two" in problems(d)[0]


def test_sizes_and_structure_are_capped():
    big = tiny()
    big["rounds"] = [copy.deepcopy(tiny()["rounds"][0]) for _ in range(13)]
    assert problems(big) == ["quiz.rounds has too many items (max 12)"]
    ha = tiny()
    ha["halftimeAfter"] = 5
    assert "halftimeAfter" in problems(ha)[0]
    for not_a_quiz in (None, [], "quiz", 5):
        assert problems(not_a_quiz)


def test_team_name_filter():
    for bad in ("Sh1t Kickers", "f u c k", "F.U.C.K", "Bitches", "Fuuuuuck yeah"):
        assert is_offensive(bad), bad
    for fine in ("Quizzly Bears", "The Scunthorpe Squad", "Assassins", "Pussycats", "Cockatoos", "Dick Fosbury fans",
                 "Shiitake mushrooms", "Cocktail Hour", "Analysts", "Penistone Pub", "Arsenal Fans", "Grape Escape"):
        assert not is_offensive(fine), fine
    assert clean("That is bullshit, Q is right!") == "That is &$%@&$%@, Q is right!"
    assert clean("f u c k this") == "(removed)"

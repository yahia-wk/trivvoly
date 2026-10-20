"""The game state machine, without any web layer. Time is faked so timers run instantly."""
import json
from pathlib import Path

import pytest

import trivvoly.game as game_mod
from trivvoly.game import CommandError, Game
from trivvoly.quiz import validate_quiz

CLASSIC = json.loads((Path(__file__).resolve().parents[2] / "quizzes" / "classic.json").read_text(encoding="utf-8"))


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(game_mod, "now", c)
    return c


@pytest.fixture
def g(clock):
    quiz, errors = validate_quiz(CLASSIC)
    assert not errors
    return Game(quiz)


def goto(g, type_, r=None, q=None):
    i = next(i for i, s in enumerate(g.slides) if s.type == type_ and (r is None or s.r == r) and (q is None or s.q == q))
    g.host_command("jump", {"index": i})


def test_slides_match_the_original_show(g):
    assert len(g.slides) == 142  # the old TV page showed "1 / 142"
    assert [s.type for s in g.slides[:4]] == ["title", "rules", "round", "question"]
    assert g.slides[-2].type == "winner" and g.slides[-1].type == "end"
    assert sum(s.type == "halftime" for s in g.slides) == 1


def test_next_reveals_before_moving_on_and_back_shows_revealed(g):
    goto(g, "answer", 0, 0)
    assert not g.st.revealed
    g.host_command("next", {})
    assert g.st.revealed and g.slide.q == 0, "first Next reveals"
    g.host_command("next", {})
    assert g.slide.q == 1 and not g.st.revealed
    g.host_command("prev", {})
    assert g.slide.q == 0 and g.st.revealed, "going back shows it revealed"


def test_timer_counts_down_from_an_end_time(g, clock):
    goto(g, "question", 0, 0)
    assert g.st.timer.mode == "q" and g.st.timer.total == 45
    g.host_command("timer", {})
    clock.t += 10
    assert g.st.timer.left(clock.t) == pytest.approx(35)
    g.host_command("timer", {})  # pause
    clock.t += 100
    assert g.st.timer.left(clock.t) == pytest.approx(35)
    g.host_command("timer", {})
    assert g.next_wakeup() == pytest.approx(clock.t + 35)
    clock.t += 36
    assert g.advance() and g.st.timer.done and g.st.timer.left(clock.t) == 0
    g.host_command("timer", {})  # restart after time's up
    assert g.st.timer.left(clock.t) == 45


def test_answers_open_only_for_shown_questions_of_the_round(g):
    team, _ = g.join("Quizzly Bears")
    goto(g, "question", 0, 1)
    g.player_command(team, "answer", {"qk": "0-0", "a": "Q"})
    g.player_command(team, "answer", {"qk": "0-1", "a": "High jump"})
    for bad in ("0-2", "1-0", "__proto__", "0-99", "tb-0", None, 5):
        with pytest.raises(CommandError):
            g.player_command(team, "answer", {"qk": bad, "a": "x"})
    goto(g, "swap", 0)
    with pytest.raises(CommandError, match="locked"):
        g.player_command(team, "answer", {"qk": "0-0", "a": "changed"})
    assert g.st.answers["0-0"][team.id].a == "Q"


def play_round_one(g):
    a, _ = g.join("Quizzly Bears")
    b, _ = g.join("Brainiacs")
    goto(g, "question", 0, 0)
    g.player_command(a, "answer", {"qk": "0-0", "a": "Q"})
    g.player_command(b, "answer", {"qk": "0-0", "a": "W"})
    goto(g, "swap", 0)
    assert g.st.pairings[0] == {a.id: b.id, b.id: a.id}
    goto(g, "answer", 0, 0)
    return a, b


def test_peer_marking_disputes_and_the_ruling_sequence(g, clock):
    a, b = play_round_one(g)
    with pytest.raises(CommandError, match="revealed"):
        g.player_command(b, "peer_mark", {"qk": "0-0", "pts": 0})
    g.host_command("next", {})  # reveal
    g.player_command(b, "peer_mark", {"qk": "0-0", "pts": 0})  # unfair!
    g.player_command(a, "dispute", {"qk": "0-0", "reason": "Q is right!"})
    assert g.st.theatre.key == f"0-0|{a.id}" and g.st.theatre.phase == "showing", "a new dispute goes straight to the big screen"
    with pytest.raises(CommandError, match="dispute"):
        g.host_command("next", {})
    with pytest.raises(CommandError):
        g.player_command(b, "peer_mark", {"qk": "0-0", "pts": 1})
    g.host_command("dispute_rule", {"key": f"0-0|{a.id}", "pts": 1})
    assert g.st.theatre.phase == "deliberating"
    clock.t += game_mod.DELIBERATE
    g.advance()
    assert g.st.theatre.phase == "verdict" and g.st.theatre.verdict == "overturned"
    assert g.st.marks["0-0"][a.id].pts == 1 and g.st.marks["0-0"][a.id].src == "host"
    clock.t += game_mod.VERDICT_SHOWN
    g.advance()
    assert g.st.theatre is None
    with pytest.raises(CommandError, match="final"):
        g.player_command(a, "dispute", {"qk": "0-0"})
    assert g.round_score(a, 0) == 1


def test_parked_disputes_wait_until_asked_for(g):
    a, b = play_round_one(g)
    g.host_command("next", {})
    g.player_command(b, "peer_mark", {"qk": "0-0", "pts": 0})
    g.player_command(a, "dispute", {"qk": "0-0"})
    key = f"0-0|{a.id}"
    g.host_command("dispute_later", {"key": key})
    assert g.st.theatre is None and key in g.st.parked
    g.host_command("next", {})  # navigation works again
    g.host_command("dispute_show", {"key": key})
    assert g.st.theatre.key == key and key not in g.st.parked


def test_jokers_double_a_round_and_can_only_be_played_on_its_intro(g):
    a, b = play_round_one(g)
    with pytest.raises(CommandError):
        g.player_command(a, "joker", {"round": 0})
    goto(g, "round", 0)
    g.player_command(a, "joker", {"round": 0})
    g.host_command("mark", {"qk": "0-0", "team": a.id, "pts": 1})
    g.host_command("mark", {"qk": "0-1", "team": a.id, "pts": 1})
    assert g.total(a) == 4
    goto(g, "round", 1)
    with pytest.raises(CommandError, match="already"):
        g.player_command(a, "joker", {"round": 1})
    g.host_command("team_update", {"team": b.id, "adj": 1.5})
    assert [r["name"] for r in g.ranked()] == ["Quizzly Bears", "Brainiacs"]


def test_manual_scores_for_paper_teams_and_marks_take_priority(g):
    paper = g._add_team("Paper Tigers", token=None)
    g.host_command("team_update", {"team": paper.id, "manual": {"round": 2, "points": 6}})
    assert g.round_score(paper, 2) == 6
    g.host_command("mark", {"qk": "2-0", "team": paper.id, "pts": 1})
    assert g.round_score(paper, 2) == 1


def test_auto_mark_fills_only_obvious_unmarked_answers(g):
    a, b = play_round_one(g)
    c, _ = g.join("Sofa Kings")
    g.host_command("next", {})
    effect = g.host_command("auto_mark", {})
    assert g.st.marks["0-0"][a.id].pts == 1 and g.st.marks["0-0"][a.id].src == "auto"
    assert g.st.marks["0-0"][c.id].pts == 0, "blank answers score 0"
    assert b.id not in g.st.marks["0-0"], "a wrong-looking answer is left for a human"
    assert "Marked 2" in effect["text"]


def test_the_winner_drumroll_then_reveal(g, clock):
    goto(g, "winner")
    g.host_command("next", {})
    assert g.st.rolling_until and not g.st.revealed
    with pytest.raises(CommandError, match="drumroll"):
        g.host_command("next", {})
    clock.t += game_mod.DRUMROLL
    g.advance()
    assert g.st.revealed


def test_team_views_hide_answers_until_revealed(g):
    a, b = play_round_one(g)
    v = g.player_view(a)
    assert v["slide"]["question"]["qk"] == "0-0"
    assert "a" not in v["slide"]["question"] and v["sheet"][0]["key"] is None
    assert v["me"]["marking"] == {"id": b.id, "name": "Brainiacs"}
    assert v["markSheet"] == [], "nothing to mark before the reveal"
    g.host_command("next", {})
    v = g.player_view(a)
    assert v["sheet"][0]["key"]["a"] == "Q"
    assert v["markSheet"][0]["their"] == "W"
    host = g.host_view(online={a.id})
    row = next(r for r in host["current"]["rows"] if r["team"] == a.id)
    assert row["suggest"] == {"level": "match", "pts": 1} and row["answer"] == "Q"


def test_team_names_are_moderated_and_unique(g):
    with pytest.raises(CommandError, match="friendly"):
        g.join("Sh1t Kickers")
    g.join("Pussycats")
    with pytest.raises(CommandError, match="taken"):
        g.join("pussycats")
    for i in range(39):
        g.join(f"Team {i}")
    with pytest.raises(CommandError, match="full"):
        g.join("One too many")


def test_dispute_reasons_are_starred_out(g):
    a, b = play_round_one(g)
    g.host_command("next", {})
    g.player_command(b, "peer_mark", {"qk": "0-0", "pts": 0})
    g.player_command(a, "dispute", {"qk": "0-0", "reason": "that is bullshit"})
    assert g.st.disputes["0-0"][a.id].reason == "that is &$%@&$%@"


def test_removing_a_team_cleans_up_everything(g):
    a, b = play_round_one(g)
    g.host_command("next", {})
    g.player_command(b, "peer_mark", {"qk": "0-0", "pts": 0})
    g.player_command(a, "dispute", {"qk": "0-0"})
    g.host_command("team_remove", {"team": a.id})
    assert a.id not in g.st.teams and g.st.theatre is None
    assert all(a.id not in by for by in g.st.answers.values())
    assert g.st.pairings[0] == {}


def test_state_survives_a_save_and_load(g):
    a, b = play_round_one(g)
    saved = g.st.model_dump_json()
    g2 = Game(g.quiz, game_mod.State.model_validate_json(saved))
    assert g2.st.pairings[0][a.id] == b.id and g2.slide == g.slide
    assert g2.team_by_token("nope") is None

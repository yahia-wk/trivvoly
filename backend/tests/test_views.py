"""Every view the server sends must match the models in trivvoly/views.py (which the frontend's
types are generated from). Plays whole games and checks each screen's view at every step."""
import json
from pathlib import Path

import pytest

import trivvoly.game as game_mod
from trivvoly.game import CommandError, Game
from trivvoly.quiz import validate_quiz
from trivvoly.views import HostView, PlayerView

CLASSIC = json.loads((Path(__file__).resolve().parents[2] / "quizzes" / "classic.json").read_text(encoding="utf-8"))


@pytest.fixture
def clock(monkeypatch):
    t = {"now": 2_000_000.0}
    monkeypatch.setattr(game_mod, "now", lambda: t["now"])
    return t


def check(g: Game, teams) -> None:
    HostView.model_validate(g.host_view(online={teams[0].id}, tv_online=True))
    for t in teams:
        PlayerView.model_validate(g.player_view(t))


def test_every_view_of_a_whole_game_matches_the_contract(clock):
    quiz, _ = validate_quiz(CLASSIC)
    g = Game(quiz)
    a, _ = g.join("Quizzly Bears")
    b, _ = g.join("Brainiacs")
    c, _ = g.join("Sofa Kings")
    g._add_team("Paper Tigers", token=None)
    g.host_command("tv_status", {"soundReady": True, "volume": 0.5})
    teams = [a, b, c]
    check(g, teams)
    for _ in range(len(g.slides) - 1):
        s = g.slide
        # play along: answer open questions, mark and dispute on answer slides, jokers on round intros
        if s.type == "round" and s.r == 0:
            g.player_command(a, "joker", {"round": s.r})
        for qk in g.open_qks():
            for t, ans in ((a, "Q"), (b, "W")):
                g.player_command(t, "answer", {"qk": qk, "a": ans, "b": "x" if g.max_pts(qk) > 1 else ""})
        g.host_command("hint", {}) if s.type == "question" and getattr(g.question(f"{s.r}-{s.q}"), "hint", None) else None
        if s.type in ("question", "tb", "halftime"):
            g.host_command("timer", {})
            clock["now"] += 1
        check(g, teams)
        if s.type in ("answer", "tb", "winner"):
            g.host_command("next", {})  # reveal (or start the drumroll)
            clock["now"] += 3
            g.advance()
            if s.type == "answer":
                qk = f"{s.r}-{s.q}"
                for t in teams:
                    try:
                        g.player_command(t, "peer_mark", {"qk": qk, "pts": 0})
                    except CommandError:
                        pass  # not everyone marks everyone
                g.host_command("auto_mark", {})
                if s.q == 0:
                    try:
                        g.player_command(a, "dispute", {"qk": qk, "reason": "Q is right!"})
                    except CommandError:
                        pass
                check(g, teams)
                if g.st.theatre:
                    g.host_command("dispute_rule", {"key": g.st.theatre.key, "pts": 1})
                    check(g, teams)  # deliberating
                    clock["now"] += game_mod.DELIBERATE
                    g.advance()
                    assert g.st.theatre.phase == "verdict"
                    check(g, teams)  # the verdict stamp
                    clock["now"] += game_mod.VERDICT_SHOWN
                    g.advance()
            check(g, teams)
        g.host_command("next", {})
        check(g, teams)
    assert g.slide.type == "end"

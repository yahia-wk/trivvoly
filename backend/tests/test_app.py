"""The web layer: REST, WebSockets, cookies and the security rules, through FastAPI's test client."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from trivvoly.app import create_app
from trivvoly.config import Config

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = {"origin": "http://testserver"}


@pytest.fixture
def make(tmp_path):
    """Build an app on a fresh database (and a fake built frontend)."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Trivvoly</title><script type=module src=/assets/app.js></script>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('hi')", encoding="utf-8")
    broken = tmp_path / "broken.json"
    broken.write_text(json.dumps({"title": "Broken", "rounds": [{"title": "R", "kind": "nope", "questions": []}]}), encoding="utf-8")

    def _make(**overrides):
        cfg = Config(database_url=f"sqlite:///{tmp_path / 'test.db'}", frontend_dir=dist, max_rooms_per_ip=100, **overrides)
        return create_app(cfg, extra_quizzes=[broken])
    return _make


@pytest.fixture
def client(make):
    with TestClient(make()) as c:
        yield c


def new_room(c, body=None):
    r = c.post("/api/rooms", json=body or {"quizId": "classic"})
    assert r.status_code == 200, r.text
    return r.json()


def cookie(c, name):
    return next((ck for ck in c.cookies.jar if ck.name == name), None)


def recv_until(ws, type_):
    for _ in range(20):
        msg = ws.receive_json()
        if msg["type"] == type_:
            return msg
    raise AssertionError(f"no {type_} message")


def test_a_broken_quiz_file_is_skipped_not_fatal(make):
    app = make()
    assert list(app.state.library) == ["classic"]
    assert any("kind must be one of" in w for w in app.state.warnings)


def test_pages_have_a_strict_security_policy(client):
    r = client.get("/")
    assert r.status_code == 200
    csp = r.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "unsafe-inline" not in csp.split("script-src")[1].split(";")[0]
    assert "frame-ancestors 'none'" in csp
    assert r.headers["referrer-policy"] == "no-referrer" and r.headers["x-frame-options"] == "DENY"
    assert client.get("/assets/app.js").status_code == 200


def test_creating_a_room_gives_a_room_only_httponly_cookie(client):
    room = new_room(client)
    assert len(room["code"]) == 6
    assert room["hostUrl"].startswith(f"/r/{room['code']}/host#k=")
    ck = cookie(client, "tvh")
    assert ck.path == f"/api/rooms/{room['code']}"
    assert ck.has_nonstandard_attr("HttpOnly") and ck.get_nonstandard_attr("SameSite", "").lower() == "strict"
    assert client.get(f"/r/{room['code']}/host").status_code == 200


def test_the_quizmaster_socket_needs_the_key(make):
    with TestClient(make()) as owner, TestClient(owner.app) as stranger:
        room = new_room(owner)
        with pytest.raises(WebSocketDisconnect) as e, stranger.websocket_connect(f"/api/rooms/{room['code']}/ws?role=host", headers=ORIGIN) as ws:
            ws.receive_json()
        assert e.value.code == 4401
        assert stranger.post(f"/api/rooms/{room['code']}/claim", json={"key": "wrong"}).status_code == 403
        key = room["hostUrl"].split("#k=")[1]
        assert stranger.post(f"/api/rooms/{room['code']}/claim", json={"key": key}).status_code == 200
        with stranger.websocket_connect(f"/api/rooms/{room['code']}/ws?role=host", headers=ORIGIN) as ws:
            quiz = recv_until(ws, "quiz")
            assert quiz["quiz"]["rounds"][0]["questions"][0]["a"] == "Q"
            assert quiz["room"]["joinUrl"].endswith("/" + room["code"])


def test_websockets_from_other_sites_are_refused(client):
    room = new_room(client)
    with pytest.raises(WebSocketDisconnect) as e, client.websocket_connect(f"/api/rooms/{room['code']}/ws?role=host", headers={"origin": "https://evil.example"}) as ws:
        ws.receive_json()
    assert e.value.code == 4403


def test_uploaded_quizzes_are_checked(client):
    bad = client.post("/api/rooms", json={"quiz": {"title": "x", "rounds": []}})
    assert bad.status_code == 422 and any("rounds" in p for p in bad.json()["problems"])
    evil = {"title": "</script><script>alert(1)", "rounds": [{"title": "R", "kind": "standard", "questions": [{"q": "<img src=x onerror=alert(1)>", "a": "a"}]}]}
    room = new_room(client, {"quiz": evil})
    assert client.get(f"/api/rooms/{room['code']}").json()["quizName"] == evil["title"], "stored as plain text, escaped when shown"


def test_teams_get_a_cookie_that_only_works_in_their_room(make):
    with TestClient(make()) as host, TestClient(host.app) as phone:
        a, b = new_room(host), new_room(host)
        r = phone.post(f"/api/rooms/{a['code']}/join", json={"name": "Quizzly Bears"})
        assert r.status_code == 200, r.text
        ck = cookie(phone, "tvp")
        assert ck.path == f"/api/rooms/{a['code']}" and ck.has_nonstandard_attr("HttpOnly")
        assert phone.post(f"/api/rooms/{a['code']}/join", json={"name": "Again"}).json()["name"] == "Quizzly Bears"
        # the same token presented to another room means nothing there
        with phone.websocket_connect(f"/api/rooms/{b['code']}/ws?role=player", headers={**ORIGIN, "cookie": f"tvp={ck.value}"}) as ws:
            assert ws.receive_json()["type"] == "needjoin"
        # a team can't act as the quizmaster
        with pytest.raises(WebSocketDisconnect), phone.websocket_connect(f"/api/rooms/{a['code']}/ws?role=host", headers=ORIGIN) as ws:
            ws.receive_json()
        assert phone.post(f"/api/rooms/{a['code']}/join", json={"name": "x"}).status_code == 200
        rude = TestClient(host.app).post(f"/api/rooms/{a['code']}/join", json={"name": "Sh1t Kickers"})
        assert rude.status_code == 400


def test_cross_site_non_json_and_oversized_requests_are_refused(client):
    assert client.post("/api/rooms", json={"quizId": "classic"}, headers={"origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/rooms", content="quizId=classic", headers={"content-type": "application/x-www-form-urlencoded"}).status_code == 415
    room = new_room(client)
    assert client.post(f"/api/rooms/{room['code']}/join", json={"name": "x" * 20000}).status_code == 413


def test_a_whole_question_over_websockets(make):
    with TestClient(make()) as tv, TestClient(tv.app) as phone:
        room = new_room(tv)
        code = room["code"]
        phone.post(f"/api/rooms/{code}/join", json={"name": "Quizzly Bears"})
        with tv.websocket_connect(f"/api/rooms/{code}/ws?role=host&screen=tv", headers=ORIGIN) as host, \
                phone.websocket_connect(f"/api/rooms/{code}/ws?role=player", headers=ORIGIN) as player:
            recv_until(host, "quiz")
            recv_until(player, "state")
            for i in range(3):  # title -> rules -> round 1 -> question 1
                host.send_json({"type": "cmd", "id": i, "cmd": "next"})
                assert recv_until(host, "result")["ok"]
            view = recv_until(player, "state")["view"]
            while view["slide"]["type"] != "question":
                view = recv_until(player, "state")["view"]
            assert view["slide"]["question"]["text"].startswith("Which letter")
            assert "a" not in view["slide"]["question"], "no answer for phones"
            player.send_json({"type": "cmd", "id": 1, "cmd": "answer", "args": {"qk": "0-0", "a": "Q"}})
            assert recv_until(player, "result")["ok"]
            state = recv_until(host, "state")["view"]
            while not state["current"]["rows"][0]["answer"]:
                state = recv_until(host, "state")["view"]
            assert state["current"]["rows"][0]["answer"] == "Q"
            host.send_json({"type": "cmd", "id": 9, "cmd": "jump", "args": {"index": 9999}})
            res = recv_until(host, "result")
            assert not res["ok"] and "no slide" in res["error"]
            host.send_json({"type": "cmd", "id": 10, "cmd": "end"})
        assert tv.get(f"/r/{code}", follow_redirects=False).headers["location"] == f"/?missing={code}"


def test_games_survive_a_restart(make):
    with TestClient(make()) as c:
        room = new_room(c)
        c.post(f"/api/rooms/{room['code']}/join", json={"name": "Survivors"})
    with TestClient(make()) as c2:
        restored = c2.app.state.rooms.get(room["code"])
        assert restored and [t.name for t in restored.game.st.teams.values()] == ["Survivors"]


def test_guessing_room_codes_gets_rate_limited(client):
    statuses = [client.get(f"/r/ZZZZZ{c}", follow_redirects=False).status_code for c in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789ABCD"]
    assert 429 in statuses


def test_the_quiz_builder_can_check_quizzes_and_load_built_in_ones(client):
    good = client.get("/api/quizzes/classic")
    assert good.status_code == 200
    quiz = good.json()
    assert quiz["title"] == "Trivia Night" and "kind" not in quiz["rounds"][0]["questions"][0], "file format, no internal tags"
    assert client.get("/api/quizzes/nope").status_code == 404
    ok = client.post("/api/quizzes/check", json={"quiz": quiz}).json()
    assert ok == {"ok": True, "problems": [], "summary": {"rounds": 7, "questions": 56}}
    del quiz["rounds"][0]["questions"][0]["a"]
    bad = client.post("/api/quizzes/check", json={"quiz": quiz}).json()
    assert bad["ok"] is False and bad["problems"] == ["quiz.rounds[0].questions[0].a is required"]
    assert client.post("/api/quizzes/check", json={"quiz": "x" * 10}).json()["ok"] is False

"""The admin area, site switches, metrics and logging."""
import json
import logging

import pytest
from fastapi.testclient import TestClient

from trivvoly.app import create_app
from trivvoly.config import Config
from trivvoly.observe import JsonFormatter

from test_accounts import CLASSIC, FakeMailer, sign_in

BOSS = "boss@example.com"


@pytest.fixture
def make(tmp_path, database_url):
    def _make(**overrides):
        cfg = Config(database_url=database_url, frontend_dir=tmp_path / "dist", max_rooms_per_ip=100,
                     admin_emails=frozenset({BOSS}), **overrides)
        app = create_app(cfg)
        app.state.accounts.mailer = FakeMailer()
        return app
    return _make


@pytest.fixture
def app(make):
    return make()


def user_id(admin, email):
    return next(u["id"] for u in admin.get("/api/admin/users", params={"q": email}).json()["users"] if u["email"] == email)


def test_admin_pages_dont_exist_for_anyone_else(app):
    with TestClient(app) as c:
        for path in ["/api/admin/overview", "/api/admin/rooms", "/api/admin/users", "/api/admin/log", "/metrics"]:
            assert c.get(path).status_code == 404, path
        sign_in(c, "someone@example.com")
        assert c.get("/api/me").json()["user"]["admin"] is False
        assert c.get("/api/admin/overview").status_code == 404
        assert c.put("/api/admin/switches", json={"pauseNewGames": True}).status_code == 404
        assert c.get("/metrics").status_code == 404


def test_the_overview(app):
    with TestClient(app) as c:
        sign_in(c, BOSS)
        assert c.get("/api/me").json()["user"]["admin"] is True
        c.post("/api/my/quizzes", json={"quiz": CLASSIC})
        c.post("/api/rooms", json={"quizId": "classic"})
        o = c.get("/api/admin/overview").json()
        assert o["games"]["live"] == 1 and o["accounts"]["users"] == 1 and o["accounts"]["savedQuizzes"] == 1
        assert o["switches"] == {"pauseNewGames": False, "pauseSignUps": False, "notice": ""}
        assert o["signIn"] == {"google": False, "email": "fake"}


def test_seeing_and_ending_games(make):
    app = make()
    with TestClient(app) as boss, TestClient(app) as tv, TestClient(app) as phone:
        sign_in(boss, BOSS)
        code = tv.post("/api/rooms", json={"quizId": "classic"}).json()["code"]
        team = phone.post(f"/api/rooms/{code}/join", json={"name": "Quizzly Bears"}).json()
        rooms = boss.get("/api/admin/rooms").json()["rooms"]
        assert rooms[0]["code"] == code and rooms[0]["teams"] == [{"id": team["id"], "name": "Quizzly Bears", "online": False}]
        # Remove a team (say its name slipped past the filter)
        assert boss.post(f"/api/admin/rooms/{code}/teams/{team['id']}/remove").json() == {"ok": True}
        assert boss.get("/api/admin/rooms").json()["rooms"][0]["teams"] == []
        # End the game
        assert boss.post(f"/api/admin/rooms/{code}/end").json() == {"ok": True}
        assert tv.get(f"/api/rooms/{code}").status_code == 404
        actions = [e["action"] for e in boss.get("/api/admin/log").json()["entries"]]
        assert actions == ["end_game", "remove_team"]


def test_banning_an_account(make):
    app = make()
    with TestClient(app) as boss, TestClient(app) as troll:
        sign_in(boss, BOSS)
        sign_in(troll, "troll@example.com")
        uid = user_id(boss, "troll@example.com")
        assert boss.post(f"/api/admin/users/{uid}/ban", json={"reason": "rude quiz titles"}).json() == {"ok": True}
        assert troll.get("/api/me").json() == {"user": None}  # signed out at once
        sent = len(app.state.accounts.mailer.sent)
        assert troll.post("/api/auth/email", json={"email": "troll@example.com"}).json() == {"ok": True}  # gives nothing away...
        assert len(app.state.accounts.mailer.sent) == sent  # ...but sends nothing
        assert [u["banned"] for u in boss.get("/api/admin/users", params={"q": "troll"}).json()["users"]] == [True]
        # Deleting the account doesn't lift the ban
        assert boss.delete(f"/api/admin/users/{uid}").json() == {"ok": True}
        troll.post("/api/auth/email", json={"email": "troll@example.com"})
        assert len(app.state.accounts.mailer.sent) == sent
        log = boss.get("/api/admin/log").json()["entries"]
        assert [(e["action"], e["target"]) for e in log] == [("delete_account", "troll@example.com"), ("ban", "troll@example.com")]


def test_a_ban_also_stops_a_link_already_sent(make):
    app = make()
    with TestClient(app) as boss, TestClient(app) as troll:
        sign_in(boss, BOSS)
        sign_in(troll, "troll@example.com")
        troll.post("/api/auth/email", json={"email": "troll@example.com"})
        token = app.state.accounts.mailer.last_token()
        boss.post(f"/api/admin/users/{user_id(boss, 'troll@example.com')}/ban", json={})
        r = troll.post("/api/auth/email/verify", json={"token": token})
        assert r.status_code == 403
        boss.post(f"/api/admin/users/{user_id(boss, 'troll@example.com')}/unban")
        sign_in(troll, "troll@example.com")
        assert troll.get("/api/me").json()["user"]["email"] == "troll@example.com"


def test_admins_cant_ban_or_delete_admins(app):
    with TestClient(app) as boss:
        sign_in(boss, BOSS)
        me = user_id(boss, BOSS)
        assert boss.post(f"/api/admin/users/{me}/ban", json={}).status_code == 400
        assert boss.delete(f"/api/admin/users/{me}").status_code == 400


def test_removing_a_saved_quiz(make):
    app = make()
    with TestClient(app) as boss, TestClient(app) as user:
        sign_in(boss, BOSS)
        sign_in(user, "sam@example.com")
        qid = user.post("/api/my/quizzes", json={"quiz": CLASSIC}).json()["id"]
        listed = boss.get(f"/api/admin/users/{user_id(boss, 'sam@example.com')}/quizzes").json()["quizzes"]
        assert [q["title"] for q in listed] == ["Trivia Night"] and "quiz" not in listed[0]  # titles, not contents
        assert boss.delete(f"/api/admin/quizzes/{qid}").json() == {"ok": True}
        assert user.get("/api/my/quizzes").json() == {"quizzes": []}


def test_site_switches(make):
    app = make()
    with TestClient(app) as boss, TestClient(app) as anyone:
        sign_in(boss, BOSS)
        sign_in(anyone, "regular@example.com")
        r = boss.put("/api/admin/switches", json={"pauseNewGames": True, "pauseSignUps": True, "notice": "  Back   at 9pm "})
        assert r.json() == {"pauseNewGames": True, "pauseSignUps": True, "notice": "Back at 9pm"}
        assert anyone.get("/api/site").json() == {"notice": "Back at 9pm", "newGamesPaused": True}
        assert anyone.post("/api/rooms", json={"quizId": "classic"}).status_code == 503
        # Sign-ups paused: newcomers can't make an account, existing accounts still sign in
        anyone.post("/api/auth/email", json={"email": "newbie@example.com"})
        assert anyone.post("/api/auth/email/verify", json={"token": app.state.accounts.mailer.last_token()}).status_code == 403
        sign_in(anyone, "regular@example.com")
        # Switches survive a restart
    with TestClient(make()) as c:
        assert c.get("/api/site").json() == {"notice": "Back at 9pm", "newGamesPaused": True}


def test_metrics(make):
    app = make(metrics_token="s3cret-token")
    with TestClient(app) as c:
        c.post("/api/rooms", json={"quizId": "classic"})
        assert c.get("/metrics", headers={"authorization": "Bearer wrong"}).status_code == 404
        r = c.get("/metrics", headers={"authorization": "Bearer s3cret-token"})
        assert r.status_code == 200
        assert 'trivvoly_rooms_created_total{source="built_in"}' in r.text
        assert "trivvoly_rooms_live 1" in r.text
        assert 'trivvoly_http_requests_total{method="POST",route="/api/rooms",status="200"}' in r.text


def test_requests_get_an_id_and_logs_leave_out_secrets(make, caplog):
    app = make(google_client_id="cid", google_client_secret="x")
    with TestClient(app) as c, caplog.at_level(logging.DEBUG, logger="trivvoly"):
        r = c.get("/api/auth/google/callback?state=abc&code=SECRET-GOOGLE-CODE", follow_redirects=False)
        assert len(r.headers["x-request-id"]) == 16
        c.post("/api/auth/email", json={"email": "private.person@example.com"})
    lines = [JsonFormatter().format(rec) for rec in caplog.records]
    assert any('"event": "request"' in line and '"route": "/api/auth/google/callback"' in line for line in lines)
    joined = "\n".join(lines)
    assert "SECRET-GOOGLE-CODE" not in joined and "private.person" not in joined
    assert '"email_domain": "example.com"' in joined
    for line in lines:
        json.loads(line)  # every line is valid JSON


def test_rate_limits_are_logged_once_not_every_time(app, caplog):
    with TestClient(app) as c, caplog.at_level(logging.INFO, logger="trivvoly"):
        for _ in range(8):
            c.post("/api/auth/email", json={"email": "victim@example.com"})
    assert sum(getattr(r, "event", "") == "rate_limited" for r in caplog.records) == 1


def test_a_banned_address_is_signed_out_even_with_a_session_left_over(app):
    """Belt and braces: a ban added any other way (e.g. straight into the database) still locks the account."""
    import time
    from sqlalchemy.orm import Session
    from trivvoly.db import BanRow
    with TestClient(app) as c:
        sign_in(c, "troll@example.com")
        with Session(app.state.accounts.engine) as db:
            db.add(BanRow(email="troll@example.com", reason="", by="db", created_at=time.time()))
            db.commit()
        assert c.get("/api/me").json() == {"user": None}


def test_clients_cant_grow_the_metrics(make):
    app = make(metrics_token="t")
    with TestClient(app) as c:
        for i in range(20):
            c.request(f"WEIRD{i}", "/api/quizzes")
        text = c.get("/metrics", headers={"authorization": "Bearer t"}).text
        assert "WEIRD" not in text and 'method="OTHER"' in text


def test_the_admin_area_needs_a_recent_sign_in(app):
    """A stolen 30-day session cookie isn't enough: admin access lasts 12 hours from signing in."""
    import time
    from sqlalchemy import update
    from sqlalchemy.orm import Session
    from trivvoly.db import SessionRow
    with TestClient(app) as c:
        sign_in(c, BOSS)
        me = c.get("/api/me").json()["user"]
        assert me["admin"] is True and me["adminUntil"] == pytest.approx(time.time() + 12 * 3600, abs=60)
        assert c.get("/api/admin/overview").status_code == 200
        with Session(app.state.accounts.engine) as db:  # pretend this sign-in was 13 hours ago
            db.execute(update(SessionRow).values(created_at=time.time() - 13 * 3600))
            db.commit()
        assert c.get("/api/me").json()["user"]["email"] == BOSS  # still signed in for everything else...
        r = c.get("/api/admin/overview")
        assert r.status_code == 401 and "sign in again" in r.json()["error"]  # ...but not for admin
        assert c.post("/api/admin/rooms/ABCDEF/end").status_code == 401
        assert c.get("/metrics").status_code == 404
        sign_in(c, BOSS)  # signing in again opens it
        assert c.get("/api/admin/overview").status_code == 200

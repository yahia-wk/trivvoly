"""Accounts: signing in by email link and with Google, and quizzes kept in an account."""
import base64
import json
import re
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from trivvoly.accounts import safe_next
from trivvoly.app import create_app
from trivvoly.config import Config
from trivvoly.db import LoginTokenRow
from trivvoly.google import GoogleError, read_id_token
from trivvoly.mail import make_mailer

ROOT = Path(__file__).resolve().parents[2]
CLASSIC = json.loads((ROOT / "quizzes" / "classic.json").read_text(encoding="utf-8"))


class FakeMailer:
    name = "fake"

    def __init__(self):
        self.sent = []

    async def send(self, email):
        self.sent.append(email)

    def last_token(self):
        return re.search(r"#t=([\w-]+)", self.sent[-1].text).group(1)


class FakeGoogle:
    client_id = "cid.apps.googleusercontent.com"

    def __init__(self):
        self.claims = {}

    async def exchange(self, code, redirect_uri, verifier):
        assert code == "good-code" and verifier
        self.redirect_uri = redirect_uri
        return id_token(self.claims)


def id_token(claims):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{enc({'alg': 'RS256'})}.{enc(claims)}.sig"


@pytest.fixture
def make(tmp_path, database_url):
    def _make(**overrides):
        cfg = Config(database_url=database_url, frontend_dir=tmp_path / "dist", max_rooms_per_ip=100, **overrides)
        app = create_app(cfg)
        app.state.accounts.mailer = FakeMailer()
        return app
    return _make


@pytest.fixture
def app(make):
    return make()


def sign_in(c, email="sam@example.com"):
    r = c.post("/api/auth/email", json={"email": email, "next": "/build"})
    assert r.status_code == 200, r.text
    r = c.post("/api/auth/email/verify", json={"token": c.app.state.accounts.mailer.last_token()})
    assert r.status_code == 200, r.text
    return r.json()


def test_signing_in_with_an_emailed_link(app):
    with TestClient(app) as c:
        assert c.get("/api/me").json() == {"user": None}
        assert c.get("/api/auth/options").json() == {"google": False, "email": True}
        r = c.post("/api/auth/email", json={"email": "  Sam@Example.com ", "next": "/build"})
        assert r.json() == {"ok": True}
        mail = app.state.accounts.mailer.sent[-1]
        assert mail.to == "sam@example.com" and "/signin/email#t=" in mail.text
        token = app.state.accounts.mailer.last_token()
        r = c.post("/api/auth/email/verify", json={"token": token})
        assert r.json() == {"user": {"name": "sam", "email": "sam@example.com", "google": False, "admin": False, "adminUntil": None}, "next": "/build"}
        session = next(ck for ck in c.cookies.jar if ck.name == "tvs")
        assert session.path == "/" and session.has_nonstandard_attr("HttpOnly")
        assert c.get("/api/me").json()["user"]["email"] == "sam@example.com"
        # A link works once
        assert c.post("/api/auth/email/verify", json={"token": token}).status_code == 400


def test_sign_in_links_expire_and_are_stored_hashed(app):
    with TestClient(app) as c:
        c.post("/api/auth/email", json={"email": "sam@example.com"})
        token = app.state.accounts.mailer.last_token()
        from sqlalchemy.orm import Session
        with Session(app.state.accounts.engine) as db:
            rows = db.query(LoginTokenRow).all()
            assert len(rows) == 1 and rows[0].token_hash != token and token not in rows[0].token_hash
            rows[0].expires_at = time.time() - 1
            db.commit()
        r = c.post("/api/auth/email/verify", json={"token": token})
        assert r.status_code == 400 and "expired" in r.json()["error"]


def test_bad_addresses_and_flooding_an_inbox_are_refused(app):
    with TestClient(app) as c:
        for bad in ["", "nope", "a@b", "a b@c.com", "<x>@y.com", "x@y.com\nBcc: z@q.com", 5]:
            assert c.post("/api/auth/email", json={"email": bad}).status_code == 400, bad
        codes = [c.post("/api/auth/email", json={"email": "victim@example.com"}).status_code for _ in range(7)]
        assert codes[:5] == [200] * 5 and codes[5] == 429
        assert len(app.state.accounts.mailer.sent) == 5


def test_requests_from_other_sites_are_refused(app):
    with TestClient(app) as c:
        r = c.post("/api/auth/email", json={"email": "sam@example.com"}, headers={"origin": "https://evil.example"})
        assert r.status_code == 403


def test_only_paths_on_this_site_are_followed_after_signing_in():
    assert safe_next("/build/abc") == "/build/abc"
    for bad in ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", None, "/" + "a" * 300, "/a b"]:
        assert safe_next(bad) == "/account", bad


def test_email_sign_in_needs_a_public_address_to_send_real_mail():
    assert make_mailer(Config(public_url="")).name == "console"  # your own machine: links go to the terminal
    assert make_mailer(Config(public_url="https://trivvoly.example")) is None  # online, no mail settings: off
    assert make_mailer(Config(public_url="", mail_from="a@b.com", smtp_host="smtp.example")) is None
    assert make_mailer(Config(public_url="https://t.example", mail_from="a@b.com", resend_api_key="k")).name == "resend"
    assert make_mailer(Config(public_url="https://t.example", mail_from="a@b.com", smtp_host="smtp.example")).name == "smtp"


def test_emailed_links_point_at_the_public_address_not_the_host_header(make):
    app = make(public_url="https://trivvoly.example")
    with TestClient(app) as c:
        c.post("/api/auth/email", json={"email": "sam@example.com"}, headers={"host": "evil.example"})
        assert "https://trivvoly.example/signin/email#t=" in app.state.accounts.mailer.sent[-1].text


def test_names_and_signing_out(app):
    with TestClient(app) as c:
        sign_in(c)
        assert c.patch("/api/me", json={"name": "  Quiz   Queen "}).json()["user"]["name"] == "Quiz Queen"
        assert c.patch("/api/me", json={"name": "shithead"}).status_code == 400
        assert c.patch("/api/me", json={"name": "x" * 41}).status_code == 400
        assert c.post("/api/auth/signout", json={}).json() == {"ok": True}
        assert c.get("/api/me").json() == {"user": None}
        assert c.patch("/api/me", json={"name": "Again"}).status_code == 401


def test_signing_out_everywhere(make):
    app = make()
    with TestClient(app) as phone, TestClient(app) as laptop:
        sign_in(phone)
        sign_in(laptop)
        assert phone.get("/api/me").json()["user"] and laptop.get("/api/me").json()["user"]
        laptop.post("/api/auth/signout", json={"everywhere": True})
        assert phone.get("/api/me").json() == {"user": None}


def test_saving_quizzes_in_an_account(app):
    with TestClient(app) as c:
        assert c.get("/api/my/quizzes").status_code == 401
        sign_in(c)
        r = c.post("/api/my/quizzes", json={"quiz": CLASSIC})
        assert r.status_code == 201
        saved = r.json()
        assert saved["ok"] is True and saved["rounds"] == 7 and saved["questions"] == 56
        # A draft with problems is kept too, marked as not ready
        draft = {"title": "Half done", "rounds": [{"title": "R1", "kind": "standard", "questions": [{"q": "?", "a": ""}]}]}
        d = c.post("/api/my/quizzes", json={"quiz": draft}).json()
        assert d["ok"] is False and d["title"] == "Half done" and d["questions"] == 1
        assert [q["title"] for q in c.get("/api/my/quizzes").json()["quizzes"]] == ["Half done", "Trivia Night"]
        assert c.get(f"/api/my/quizzes/{d['id']}").json()["quiz"] == draft
        # Update and delete
        draft["rounds"][0]["questions"][0]["a"] = "!"
        assert c.put(f"/api/my/quizzes/{d['id']}", json={"quiz": draft}).json()["updatedAt"] >= d["updatedAt"]
        assert c.delete(f"/api/my/quizzes/{d['id']}").json() == {"ok": True}
        assert c.get(f"/api/my/quizzes/{d['id']}").status_code == 404
        assert c.post("/api/my/quizzes", json={"quiz": "nope"}).status_code == 400


def test_nobody_else_can_see_or_change_your_quizzes(make):
    app = make()
    with TestClient(app) as alice, TestClient(app) as bob:
        sign_in(alice, "alice@example.com")
        sign_in(bob, "bob@example.com")
        qid = alice.post("/api/my/quizzes", json={"quiz": CLASSIC}).json()["id"]
        assert bob.get(f"/api/my/quizzes/{qid}").status_code == 404
        assert bob.put(f"/api/my/quizzes/{qid}", json={"quiz": CLASSIC}).status_code == 404
        assert bob.delete(f"/api/my/quizzes/{qid}").status_code == 404
        assert bob.post("/api/rooms", json={"savedQuizId": qid}).status_code == 404
        assert bob.get("/api/my/quizzes").json() == {"quizzes": []}
        assert alice.get(f"/api/my/quizzes/{qid}").status_code == 200


def test_starting_a_game_with_a_saved_quiz(app):
    with TestClient(app) as c:
        sign_in(c)
        qid = c.post("/api/my/quizzes", json={"quiz": CLASSIC}).json()["id"]
        r = c.post("/api/rooms", json={"savedQuizId": qid})
        assert r.status_code == 200 and r.json()["hostUrl"].startswith("/r/")
        draft = c.post("/api/my/quizzes", json={"quiz": {"title": "WIP", "rounds": []}}).json()["id"]
        r = c.post("/api/rooms", json={"savedQuizId": draft})
        assert r.status_code == 422 and "things to fix" in r.json()["error"]
        c.post("/api/auth/signout", json={})
        assert c.post("/api/rooms", json={"savedQuizId": qid}).status_code == 401


def test_an_account_holds_a_limited_number_of_quizzes(make):
    with TestClient(make(max_saved_quizzes=2)) as c:
        sign_in(c)
        assert [c.post("/api/my/quizzes", json={"quiz": CLASSIC}).status_code for _ in range(3)] == [201, 201, 409]


def test_deleting_an_account_removes_everything(app):
    with TestClient(app) as c:
        sign_in(c)
        c.post("/api/my/quizzes", json={"quiz": CLASSIC})
        assert c.delete("/api/me").json() == {"ok": True}
        assert c.get("/api/me").json() == {"user": None}
        sign_in(c)  # the same address starts afresh
        assert c.get("/api/my/quizzes").json() == {"quizzes": []}


# ---------- Google ----------

def google_app(make):
    app = make(google_client_id="cid.apps.googleusercontent.com", google_client_secret="secret")
    app.state.accounts.google = FakeGoogle()
    return app


def start_google(c, next_path="/build"):
    r = c.get(f"/api/auth/google/start?next={next_path}", follow_redirects=False)
    assert r.status_code == 302
    url = urlparse(r.headers["location"])
    q = {k: v[0] for k, v in parse_qs(url.query).items()}
    assert url.netloc == "accounts.google.com"
    assert q["code_challenge_method"] == "S256" and q["scope"] == "openid email profile"
    assert q["redirect_uri"] == "http://testserver/api/auth/google/callback"
    return q


def good_claims(q, **extra):
    return {"iss": "https://accounts.google.com", "aud": "cid.apps.googleusercontent.com", "sub": "g-123",
            "email": "Sam@Example.com", "email_verified": True, "name": "Sam Smith", "nonce": q["nonce"],
            "exp": time.time() + 3600, **extra}


def test_signing_in_with_google(make):
    app = google_app(make)
    with TestClient(app) as c:
        assert c.get("/api/auth/options").json()["google"] is True
        q = start_google(c)
        app.state.accounts.google.claims = good_claims(q)
        r = c.get(f"/api/auth/google/callback?state={q['state']}&code=good-code", follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"] == "/build"
        assert c.get("/api/me").json()["user"] == {"name": "Sam Smith", "email": "sam@example.com", "google": True, "admin": False, "adminUntil": None}


def test_google_and_email_sign_in_reach_the_same_account(make):
    app = google_app(make)
    with TestClient(app) as c:
        sign_in(c, "sam@example.com")
        c.post("/api/my/quizzes", json={"quiz": CLASSIC})
        c.post("/api/auth/signout", json={})
        q = start_google(c)
        app.state.accounts.google.claims = good_claims(q)
        c.get(f"/api/auth/google/callback?state={q['state']}&code=good-code", follow_redirects=False)
        me = c.get("/api/me").json()["user"]
        assert me["google"] is True and me["name"] == "sam"  # the name they already had stays
        assert len(c.get("/api/my/quizzes").json()["quizzes"]) == 1


@pytest.mark.parametrize("tamper", ["state", "nonce", "aud", "iss", "unverified", "expired", "no_cookie"])
def test_google_sign_in_refuses_anything_off(make, tamper):
    app = google_app(make)
    with TestClient(app) as c:
        q = start_google(c)
        claims = good_claims(q)
        state = q["state"]
        if tamper == "state":
            state = "someone-elses-state"
        elif tamper == "nonce":
            claims["nonce"] = "replayed"
        elif tamper == "aud":
            claims["aud"] = "another-app"
        elif tamper == "iss":
            claims["iss"] = "https://evil.example"
        elif tamper == "unverified":
            claims["email_verified"] = False
        elif tamper == "expired":
            claims["exp"] = time.time() - 600
        elif tamper == "no_cookie":
            c.cookies.clear()
        app.state.accounts.google.claims = claims
        r = c.get(f"/api/auth/google/callback?state={state}&code=good-code", follow_redirects=False)
        assert r.headers["location"] == "/signin?error=google"
        assert c.get("/api/me").json() == {"user": None}


def test_google_sign_in_is_off_until_configured(app):
    with TestClient(app) as c:
        assert c.get("/api/auth/google/start", follow_redirects=False).status_code == 404


def test_reading_google_id_tokens():
    claims = {"iss": "accounts.google.com", "aud": "cid", "sub": "1", "email": "A@B.com", "email_verified": True, "nonce": "n", "exp": 2e9}
    assert read_id_token(id_token(claims), "cid", "n").email == "a@b.com"
    with pytest.raises(GoogleError):
        read_id_token("not-a-token", "cid", "n")

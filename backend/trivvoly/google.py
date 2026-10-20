"""Sign in with Google: the OpenID Connect authorization-code flow, run entirely on the server
(no Google script on our pages, so the strict Content-Security-Policy stays as it is).

The browser goes to Google with a random `state` (tying the answer to this browser), a PKCE
challenge and a `nonce`; Google sends it back with a code, which we swap for an ID token over a
direct TLS connection to Google. Because the token comes straight from Google's token endpoint
rather than through the browser, OpenID Connect lets us rely on TLS instead of checking its
signature (OIDC Core 3.1.3.7); we still check who it was issued by and for, its expiry and nonce.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class GoogleError(Exception):
    pass


@dataclass
class GoogleUser:
    sub: str
    email: str
    name: str


@dataclass
class Attempt:
    """What we remember (in a short-lived cookie) between sending someone to Google and their return."""
    state: str
    verifier: str
    nonce: str

    @classmethod
    def new(cls) -> Attempt:
        return cls(secrets.token_urlsafe(24), secrets.token_urlsafe(48), secrets.token_urlsafe(24))

    def dump(self) -> str:
        return f"{self.state}.{self.verifier}.{self.nonce}"

    @classmethod
    def load(cls, raw: str | None) -> Attempt | None:
        parts = (raw or "").split(".")
        return cls(*parts) if len(parts) == 3 and all(parts) else None


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def authorize_url(client_id: str, redirect_uri: str, attempt: Attempt) -> str:
    challenge = _b64(hashlib.sha256(attempt.verifier.encode()).digest())
    return AUTH_URL + "?" + urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
        "scope": "openid email profile", "state": attempt.state, "nonce": attempt.nonce,
        "code_challenge": challenge, "code_challenge_method": "S256", "prompt": "select_account",
    })


def read_id_token(id_token: str, client_id: str, nonce: str, now: float | None = None) -> GoogleUser:
    try:
        payload = id_token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        raise GoogleError("Google sent an unreadable ID token") from None
    now = time.time() if now is None else now
    if claims.get("iss") not in ISSUERS:
        raise GoogleError("ID token from the wrong issuer")
    aud = claims.get("aud")
    if aud != client_id and not (isinstance(aud, list) and client_id in aud):
        raise GoogleError("ID token meant for another app")
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < now - 60:
        raise GoogleError("ID token has expired")
    if not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
        raise GoogleError("ID token nonce doesn't match")
    if claims.get("email_verified") is not True or not isinstance(claims.get("email"), str):
        raise GoogleError("Google hasn't verified this email address")
    if not isinstance(claims.get("sub"), str) or not claims["sub"]:
        raise GoogleError("ID token has no subject")
    return GoogleUser(sub=claims["sub"], email=claims["email"].lower(), name=str(claims.get("name") or "")[:60])


class GoogleClient:
    """Swappable in tests (exchange is the only part that talks to Google)."""

    def __init__(self, client_id: str, client_secret: str) -> None:
        self.client_id, self.client_secret = client_id, client_secret

    async def exchange(self, code: str, redirect_uri: str, verifier: str) -> str:
        """The authorization code for an ID token."""
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(TOKEN_URL, data={
                "code": code, "client_id": self.client_id, "client_secret": self.client_secret,
                "redirect_uri": redirect_uri, "grant_type": "authorization_code", "code_verifier": verifier,
            })
        if r.status_code != 200 or not isinstance(r.json().get("id_token"), str):
            raise GoogleError(f"Google refused the sign-in code ({r.status_code})")
        return r.json()["id_token"]

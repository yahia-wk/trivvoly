"""Sending sign-in links by email: Resend's API, any SMTP server, or (on your own machine) the terminal."""
from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from html import escape
from typing import Protocol

import httpx

from .config import Config

log = logging.getLogger("trivvoly")


@dataclass
class Email:
    to: str
    subject: str
    text: str
    html: str


class Mailer(Protocol):
    name: str

    async def send(self, email: Email) -> None: ...


class ConsoleMailer:
    """For running on your own machine: the link appears in the terminal instead of an inbox."""
    name = "console"

    async def send(self, email: Email) -> None:
        body = "\n".join("  " + line for line in email.text.strip().splitlines())
        print(f"\n  --- Email to {email.to}: {email.subject} ---\n{body}\n", flush=True)


class ResendMailer:
    name = "resend"

    def __init__(self, api_key: str, sender: str) -> None:
        self.api_key, self.sender = api_key, sender

    async def send(self, email: Email) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {self.api_key}"},
                                  json={"from": self.sender, "to": [email.to], "subject": email.subject, "text": email.text, "html": email.html})
        if r.status_code >= 300:
            raise RuntimeError(f"Resend refused the email ({r.status_code})")


class SmtpMailer:
    name = "smtp"

    def __init__(self, config: Config) -> None:
        self.config = config

    def _send(self, email: Email) -> None:
        c = self.config
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = c.mail_from, email.to, email.subject
        msg.set_content(email.text)
        msg.add_alternative(email.html, subtype="html")
        context = ssl.create_default_context()
        if c.smtp_port == 465:
            server: smtplib.SMTP = smtplib.SMTP_SSL(c.smtp_host, c.smtp_port, timeout=15, context=context)
        else:
            server = smtplib.SMTP(c.smtp_host, c.smtp_port, timeout=15)
            server.starttls(context=context)
        with server:
            if c.smtp_user:
                server.login(c.smtp_user, c.smtp_password)
            server.send_message(msg)

    async def send(self, email: Email) -> None:
        await asyncio.to_thread(self._send, email)


def make_mailer(config: Config) -> Mailer | None:
    """None means email sign-in is off. A real mailer needs PUBLIC_URL, so links in emails never
    point at whatever Host header a request happened to send."""
    if config.mail_from and (config.resend_api_key or config.smtp_host):
        if not config.public_url:
            log.warning("Email sign-in is off: set PUBLIC_URL as well as the mail settings.")
            return None
        return ResendMailer(config.resend_api_key, config.mail_from) if config.resend_api_key else SmtpMailer(config)
    if not config.public_url:
        return ConsoleMailer()
    return None


def sign_in_email(to: str, link: str, minutes: int) -> Email:
    safe = escape(link, quote=True)
    text = (f"Hello from Trivvoly!\n\nUse this link to sign in:\n{link}\n\n"
            f"It works once, for the next {minutes} minutes. If you didn't ask to sign in, ignore this email: "
            "nobody can get in without the link.\n")
    html = (f'<p>Hello from Trivvoly!</p><p><a href="{safe}" style="display:inline-block;padding:12px 20px;'
            f'background:#f5b83d;color:#12040e;border-radius:10px;font-weight:700;text-decoration:none">Sign in to Trivvoly</a></p>'
            f"<p>The link works once, for the next {minutes} minutes. If you didn't ask to sign in, ignore this email: "
            "nobody can get in without the link.</p>")
    return Email(to=to, subject="Your Trivvoly sign-in link", text=text, html=html)

# Hosting Trivvoly

Trivvoly is one container: the game server, which also serves the screens. Run it behind HTTPS (your hosting provider's proxy or load balancer usually does this) with a database.

## The quick way: Docker Compose

[`docker-compose.yml`](../docker-compose.yml) runs Trivvoly with a Postgres database:

```
docker compose up --build -d
```

Put the settings below in a `.env` file next to `docker-compose.yml`. Compose reads it automatically. Never commit it.

```
PUBLIC_URL=https://trivvoly.example.com
POSTGRES_PASSWORD=a-long-random-password
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MAIL_FROM=Trivvoly <signin@trivvoly.example.com>
RESEND_API_KEY=...
```

The [Dockerfile](../Dockerfile) on its own works too, with SQLite in a volume mounted at `/data`.

## Settings

| Variable | What it does |
| --- | --- |
| `PUBLIC_URL` | The site's address, e.g. `https://trivvoly.example.com`. Used in join links, QR codes and sign-in emails. **Required online.** |
| `TRUST_PROXY=1` | Behind exactly one proxy or load balancer (the usual setup): take the client address from the last `X-Forwarded-For` entry and HTTPS from `X-Forwarded-Proto`. On by default in the Docker image. Turn it off if the server is reachable directly, or clients could fake their address. |
| `DATABASE_URL` | SQLite (`sqlite:////data/trivvoly.db`, the image's default) or Postgres (`postgresql+psycopg://user:password@host:5432/trivvoly`). Tables are created on first start. |
| `PORT` | Port to listen on (default 3000). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Turn on "Continue with Google". See below. |
| `MAIL_FROM` + `RESEND_API_KEY` | Turn on email sign-in links, sent through [Resend](https://resend.com). See below. |
| `MAIL_FROM` + `SMTP_HOST`, `SMTP_PORT` (587, or 465 for TLS), `SMTP_USER`, `SMTP_PASSWORD` | ...or sent through any SMTP server instead. |
| `TRIVVOLY_MAX_ROOMS`, `TRIVVOLY_MAX_ROOMS_PER_IP` | How many games can run at once, in all and per address (defaults 300 and 5). |
| `TRIVVOLY_MAX_SAVED_QUIZZES` | Quizzes per account (default 100). |

`GET /healthz` answers `ok` for health checks.

## Accounts

You don't need an account to play or host. Accounts are for quizmasters to keep their quizzes. There are two ways to sign in, and you can turn on either or both:

- **Running on your own machine** (no `PUBLIC_URL`): email sign-in works with no setup. The link is printed in the server's terminal instead of being emailed.
- **Online**, each way needs the setup below. Without it, that way of signing in is hidden.

### Google sign-in

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a project (e.g. "Trivvoly").
2. Open **Google Auth Platform** (APIs & Services → OAuth consent screen). Choose **External**, then fill in the app name, a support email and your contact email. The only scopes needed are `openid`, `email` and `profile`. These are non-sensitive, so Google doesn't need to review the app.
3. Under **Clients**, choose **Create client**, then **Web application**. Under **Authorized redirect URIs**, add:
   - `https://YOUR-DOMAIN/api/auth/google/callback`
   - `http://localhost:3000/api/auth/google/callback` (optional, for testing on your machine)
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Under **Audience**, choose **Publish app**. Until you do, only the test users listed there can sign in.

How it works: the server does the whole exchange with Google, using the authorization-code flow with PKCE, a `state` check and a nonce. No Google script runs on Trivvoly's pages. Trivvoly receives only the person's Google ID, email address and name.

### Email sign-in links

Using [Resend](https://resend.com), which has a free tier:

1. Sign up, add your domain under **Domains** and create the DNS records it shows (SPF and DKIM). This lets your emails reach inboxes, not spam folders.
2. Create an API key with "sending access" only, and put it in `RESEND_API_KEY`.
3. Set `MAIL_FROM` to an address on that domain, e.g. `Trivvoly <signin@trivvoly.example.com>`.

Or use any SMTP provider (Postmark, Mailgun, Amazon SES, your own) with the `SMTP_*` settings.

How it works:
- Each link works once, for 15 minutes.
- Links use `PUBLIC_URL`, never the address a request claims to come from. A real mailer stays off until `PUBLIC_URL` is set.
- The code travels in the link's `#` part, and the page posts it to sign in. So it never appears in server logs, and mail scanners that open links can't use it up.
- Each address can ask for 5 links an hour, so nobody can flood someone's inbox.

## What's stored

- **Games:** each room's state, while it runs. Rooms are deleted after 12 hours, after 3 hours idle, or when the quizmaster ends the game.
- **Accounts:** email address, name, Google ID (if used) and saved quizzes. People can delete their account, and everything in it, from the account page.
- **Hashes only:** sign-in sessions (30 days), sign-in links (15 minutes) and quizmaster keys are stored only as SHA-256 hashes.

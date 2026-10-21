# Hosting Trivvoly

Trivvoly is one container: the game server, which also serves the screens. Run it behind HTTPS (your hosting provider's proxy or load balancer usually does this) with a database.

## The quick way: Docker Compose

[`docker-compose.yml`](../docker-compose.yml) runs Trivvoly with a Postgres database:

```
cp .env.example .env     # then set POSTGRES_PASSWORD (and, online, the rest)
docker compose up --build -d
```

Compose reads `.env` automatically and won't start until `POSTGRES_PASSWORD` is set: there is no default password. `.env` is in `.gitignore`, so it isn't committed. Keep it that way. One way to make a strong password: `python -c "import secrets; print(secrets.token_urlsafe(24))"`.

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
| `ADMIN_EMAILS` | Comma-separated email addresses whose accounts can open the admin area at `/admin`. See below. |
| `ADMIN_SESSION_HOURS` | How long admin access lasts after signing in (default 12). After that the admin area asks you to sign in again. |
| `LOG_FORMAT` | `text` (readable in a terminal) or `json` (one object per line, for log search; the Docker image's default). |
| `LOG_LEVEL` | `INFO` (default: requests and game events) or `WARNING` (only problems). |
| `METRICS_TOKEN` | Lets a monitoring service read `GET /metrics` (Prometheus format) with `Authorization: Bearer <token>`. Admins can always open it. |

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

## The admin area

Sign in with an address listed in `ADMIN_EMAILS`. Your account page then links to **Admin** (`/admin`). Only that setting can make someone an admin; nothing in the database can. To everyone else, every admin page and API answers "not found". Admin access also needs a recent sign-in: it lasts 12 hours from signing in (`ADMIN_SESSION_HOURS`), then asks you to sign in again. So a stolen sign-in cookie, which otherwise lasts 30 days, isn't enough for admin. Your normal sign-in carries on for everything else.

- **Overview:** games running, teams, screens, accounts, sign-ins, errors and recent problems (the last warnings and errors, with request IDs to search the logs for).
- **Switches:** pause new games (running games carry on), pause new sign-ups (existing accounts still sign in), and a notice shown at the top of the start page, e.g. before a restart. They survive restarts.
- **Live games:** every running game with its teams. Remove a team (say, a name that slipped past the filter) or end a game.
- **Accounts:** search by email or name; see each account's saved quizzes by title (not their contents); delete a quiz; sign someone out everywhere; ban (signs them out and stops that address signing in or signing up again, even if the account is deleted); delete an account. Admin accounts can't be banned or deleted from here.
- **Admin log:** every admin action (who, what, when), kept in the database.

## Logs and monitoring

Logs go to standard output, never to files, and nothing is held in memory except the last 200 warnings and errors for the admin page. Your host collects them. `docker-compose.yml` caps Docker's log files at 5 × 10 MB per container; without a cap, Docker keeps logs forever.

What's logged, one line each:

- **Requests:** method, path (never the query string), route, status, time taken, client address and a request ID. The request ID is also sent back as the `X-Request-ID` header. Health checks, static files and refused (429) requests are logged only at debug level.
- **Games:** started (quiz title, where the quiz came from, address), ended (why, how long, how many teams), team joined or refused (the reason, never the name), screen disconnected (role, seconds open, number of messages).
- **Accounts:** sign-in link sent (email domain only), signed in (method, account ID, new or not), sign-in failed (reason), account deleted.
- **Problems:** rate limits hit (once per limit window, not per request), emails that failed to send, games that failed to save, unhandled errors with their stack trace.
- **Admin actions.**

Never logged: query strings, cookies, request bodies, sign-in tokens or keys, full email addresses, team names, answers.

Volume: a two-hour game with ten teams makes a few hundred lines (around 100 KB). `LOG_LEVEL=WARNING` keeps only problems.

`/metrics` counts requests (by route and status), games started and ended, teams joined, sign-ins, rate-limited requests and WebSocket messages. It also shows games, teams and screens live now. Every label comes from a fixed list, so clients can't make it grow.

## What's stored

- **Games:** each room's state, while it runs. Rooms are deleted after 12 hours, after 3 hours idle, or when the quizmaster ends the game.
- **Accounts:** email address, name, Google ID (if used) and saved quizzes. People can delete their account, and everything in it, from the account page.
- **Hashes only:** sign-in sessions (30 days), sign-in links (15 minutes) and quizmaster keys are stored only as SHA-256 hashes.
- **Admin:** banned addresses (with the reason), the admin log, and the site switches.

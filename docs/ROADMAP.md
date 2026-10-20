# Trivvoly roadmap: from living-room LAN game to online service

Trivvoly today runs on one PC for one game: a big-screen show, team phones, peer marking, disputes and a quizmaster phone remote. The goal is to run the same game online for anyone: a quizmaster opens a room, players join with a QR code or room code, and quizzes come from a question bank or are written by users.

## Decisions so far

| Question | Decision |
| --- | --- |
| Who is it for? | Friends **and** anyone on the internet. Safety is a priority, not an afterthought. |
| Money | Free. No charging for now; ads or similar may come later, but they don't shape the design today. |
| Game feel | Keep the current mechanics and vibe: TV show, free-text answers, jokers, peer marking, disputes ruled on the big screen. Scale it, don't turn it into a Kahoot clone. Multiple-choice is added later as one more question type. |
| Self-hosting | Keep it. "Run it free on your own PC, or use the hosted version." |
| Tech stack | **Backend: Python + FastAPI** (the owner maintains it and knows Python best), Pydantic for every model, WebSockets for live updates, SQLAlchemy (SQLite now, Postgres in Phase 2), pytest. **Frontend: React + TypeScript + Vite**, one app for every screen. Styling is flexible: CSS Modules carry the existing custom look over, Tailwind is available for new screens, both on one shared set of colour and font tokens. |
| Who runs the game | **The server.** Each room's state (current slide, timer, reveals, marks, scores, disputes) lives on the server; the TV, team phones and the quizmaster's remote are views that send commands. Sound, animation and lights stay on the TV. |
| Licence | MIT for now. **Open decision:** before the hosted service grows, consider AGPL so nobody can run a closed, modified copy as a competing service. Easy to switch while there is a single author. |

## What changes and what doesn't

Already done and reusable as-is: live updates (Server-Sent Events), answers hidden from phones until revealed, the show, the phone remote, peer marking and disputes.

New work:

1. **Rooms.** One game per room instead of one per server: a short room code and QR link, a secret quizmaster link per room, and automatic expiry of idle rooms.
2. **Quizzes as data.** Questions move out of the code into validated quiz files. This underpins everything else.
3. **Quizmaster accounts.** Sign-in with Google or an email link (no passwords). Players stay anonymous: team name only.
4. **Database** for accounts, saved quizzes and the question bank (Postgres). Live game state stays in memory.
5. **Quiz builder** web page, plus spreadsheet/JSON import.
6. **Question bank** with categories, difficulty and tags, and "generate a quiz from these categories". Seeded from questions we write and properly licensed open sources (e.g. Open Trivia DB is CC BY-SA: credit required, check terms).

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| **0** | Questions move into quiz files (`quizzes/*.json`) with a strict validator; built-in assets (flags) stay in code and quizzes refer to them by id; every quiz text shown on screen is escaped; tidy folder layout; tests. | **Done** |
| **1** | Rooms: many games per server, room codes + QR, per-room host secrets, room expiry, choose a built-in quiz or upload a quiz file. Deploy one server online with HTTPS. No accounts yet. | **Built and tested**; deploying is next (needs a hosting account) |
| **1.5** | **Rebuild** on the stack above, keeping every feature and the look. See "The rebuild" below. | **Done** (follow-ups listed there) |
| **2** | Quizmaster accounts, quiz builder, saved quizzes, import from spreadsheet/JSON. Postgres. | |
| **3** | Question bank: categories, difficulty, "generate a quiz", multiple-choice question type with automatic scoring. | |
| **4** | Community: public quizzes, sharing, ratings, reporting, moderation tools. | |

## The rebuild (Phase 1.5)

Why: the prototype grew one feature at a time inside three large HTML files (markup, styles and logic together), and the TV's browser was the game's brain, with the server relaying copies. That doesn't scale to accounts, a builder and a question bank.

Layout:

```
backend/    FastAPI app (package `trivvoly`): quiz models, game state machine, rooms, realtime, security, moderation; pytest suite
frontend/   React + TypeScript + Vite app: start page, team phone, TV show, remote (later: builder, accounts)
quizzes/    built-in quizzes (unchanged format)
shared/     assets used by both sides (flag library as JSON)
docs/
```

Design points:

- **Server-owned game state.** Commands (next, reveal, start timer, mark, rule on a dispute, …) go to the server, which updates the room and sends each connection the view it's allowed to see: the TV and remote get everything, phones get only public data. The timer is an end time, so every screen counts down in sync. Dispute rulings are a server-side sequence (showing → deliberating → verdict) the TV animates.
- **One WebSocket per screen**, authenticated by the room cookie, with an Origin check on the handshake (cookies alone don't protect WebSockets from other sites) and per-connection rate limits.
- **Pydantic is the single source of truth** for the quiz format and every message; TypeScript types for the frontend are generated from it, so the two can't drift.
- **Same security model as Phase 1**: room-scoped HttpOnly cookies, keys in the link's `#` part, strict CSP (simpler now: the built app has no inline scripts), size and rate limits, moderation, expiry. Quizmaster keys are stored hashed.
- **One container**: FastAPI serves the built React app from the same address.

Steps (the game keeps working at each one; the old Node app stays until the switch):

1. Backend: models, state machine, rooms, realtime, security, moderation; every existing test ported plus state-machine tests.
2. Frontend, simplest screen first: start page → team phone → remote → TV show; screenshot comparison against the current version.
3. Switch over: remove the Node app, update the Dockerfile, README and this roadmap.

All three steps are done. Follow-ups:

- ~~**View types**~~ Done: the views the server sends are described in `backend/trivvoly/views.py`; `tests/test_views.py` plays whole games and checks every view against them (unknown fields fail), and the frontend's types are generated from them with the quiz types (`frontend/src/lib/contract.gen.ts`).
- **Frontend unit tests**: left out for now because the test runner that supports Node 20.11 (Vitest 3) has known vulnerabilities; add Vitest 5 after moving to Node 22. Until then the frontend is checked by TypeScript and by full browser rehearsals.
- **Docker image**: rewritten for the new stack but not yet built and run here (Docker Desktop wasn't running).
- **Node 22**: upgrading would also allow the newest Vite and React Router.

## Where quizzes live

- **The quiz format is the contract; files are temporary storage.** `backend/trivvoly/quiz.py` is what every quiz must pass, wherever it comes from. The `quizzes/` folder holds only built-in quizzes and self-hosters' quizzes.
- **Online (Phase 2): Postgres.** A `questions` table (one row per question: type, category, difficulty, tags, author, visibility, moderation status, and the per-type content as JSONB in the same shape as the file format) so the bank is searchable and questions can be shared between quizzes; a `quizzes` table (title, owner, settings) with ordered rounds referencing questions.
- **Every write is validated** with the same rules: the builder, imports, the API.
- **Rooms snapshot their quiz at start**, so editing a quiz never disturbs a game in progress.
- **JSON files stay as import/export** (backup, sharing, moving between servers) and the `format` number lets old files be migrated.

## Failure isolation

One bad quiz must never affect anyone else.

- **On save or upload:** rejected with the list of problems shown to the author; never stored.
- **On room start:** if a stored quiz fails validation (e.g. after a format change), only that room refuses to start, with a message to the quizmaster.
- **Built-in quizzes at startup:** an invalid file is skipped with a warning; the server starts with the rest. (Done in Phase 1.)

## Safety (applies from Phase 1 onwards, designed in from Phase 0)

- **Content is data, never code.** Quiz files are validated against a strict format: only known fields, length limits, limited counts. Unknown fields are dropped. Images and flags come from a built-in library by id, so a quiz can never inject markup or scripts. Every piece of quiz or player text is HTML-escaped when shown.
- **Secrets.** Quizmaster links carry an unguessable secret per room. The show and remote pages (which contain answers) are only served with that secret. Answers never reach player phones before the reveal.
- **Abuse limits.** Rate limits on joining, answering and room creation; caps on teams per room, rooms per IP and request sizes; room codes long enough not to be guessed by scanning.
- **Names and text from players.** Profanity filter on team names and dispute reasons; the quizmaster can remove a team at any time.
- **Public content (Phase 4).** Report button, review queue, ability to unpublish; private quizzes are never listed.
- **Privacy.** Collect as little as possible: no player accounts, quizmaster email only, no tracking. A short privacy page. Delete room data when a room expires.
- **Transport.** HTTPS only in the hosted version; security headers (CSP, no framing).

## What Phase 1 put in place

(Built first in Node, then carried over unchanged in behaviour to the Python backend in the rebuild: `rooms.py`, `game.py`, `security.py`, `moderation.py`. The file names below are the original Node ones.)

- **Rooms** (`lib/rooms.js`): 6-character codes from an alphabet without O/0/I/1 (about a billion combinations), a 128-bit quizmaster key per room, at most 300 rooms per server and 5 per address, expiry after 12 hours or 3 idle hours, and **End game** deletes a room immediately. Running games are saved to disk so a restart or deploy doesn't end them.
- **Quizmaster links** look like `/r/K7QM2X/host#k=<key>`. The key is in the `#` part, which browsers never send to the server (so it never reaches logs), and is swapped for an HttpOnly, SameSite=Strict cookie scoped to `/r/K7QM2X`. The address bar is then wiped.
- **Teams** get an HttpOnly cookie for their room when they join; no secrets in page scripts or URLs.
- **Everything from browsers is checked** (`lib/game.js`), including what the room's own quizmaster page sends: question keys and team ids must match strict patterns (this closed a prototype-pollution hole that could have affected every room), slides are rebuilt field by field, flags are names from the built-in library.
- **HTTP hardening** (`lib/http.js`): a Content-Security-Policy with a fresh nonce per page (no inline scripts except ours, no third-party scripts; the QR library is bundled), `no-referrer`, no framing, JSON-only POSTs with an Origin check, size limits per request type.
- **Rate limits**: room creation, joining, quizmaster-key attempts, room-code lookups (stops code guessing), and per-team actions. Per-address limits are generous because a whole pub can share one address.
- **Moderation**: team names with offensive words are refused; dispute reasons are starred out (`lib/moderation.js`, using the `obscenity` library with a short allow-list for innocent words like "Pussycats" and "Dick Fosbury").

Still to consider before heavy traffic: a global cap on open live connections, logging/monitoring, and running more than one server process (rooms would need shared storage such as Redis).

## Hosting (Phase 1)

A server that stays running (live connections rule out "serverless" hosts like Vercel): a small VPS (Hetzner, DigitalOcean) or a platform like Fly.io, Railway or Render, plus a managed Postgres free tier (Neon, Supabase) from Phase 2. Rough hobby-scale cost: about $5–25 a month plus the domain (prices to be checked). One Node process should handle hundreds of concurrent rooms; scaling to several servers (shared state via Redis) only if it gets popular.

## Quiz file format (Phase 0)

See [`quizzes/classic.json`](../quizzes/classic.json) for a full example and [`backend/trivvoly/quiz.py`](../backend/trivvoly/quiz.py) for the exact rules. In short:

```json
{
  "format": 1,
  "title": "Trivia Night",
  "halftimeAfter": 3,
  "rules": [{ "icon": "👥", "text": "Teams of up to six." }],
  "rounds": [{
    "title": "Pot luck", "icon": "🎲", "kind": "standard",
    "blurb": "A bit of everything.", "scoring": "8 questions, 1 point each.",
    "questions": [{ "icon": "🔤", "q": "Which letter…?", "a": "Q", "fact": "…", "mark": "…" }]
  }],
  "tiebreakers": [{ "icon": "💀", "q": "How many bones…?", "a": "206" }],
  "tunes": [{ "inst": "brass", "unit": 0.14, "notes": "C4:2 D4:1 …" }]
}
```

Round kinds: `standard`, `flag`, `music`, `emoji`, `vowels`, `versus`.

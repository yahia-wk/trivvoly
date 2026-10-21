# Trivvoly

> Pens down! A live trivia night for a TV and everyone's phones.

A pub-quiz show for a TV or projector, with phones for the teams and a phone remote for the quizmaster: free-text answers, jokers, teams marking each other's answers, and disputes ruled on the big screen. Many games can run at once, each in its own room.

## Play it

**Windows:** double-click `start-trivia.bat`. The first run sets everything up (needs [Python](https://www.python.org) 3.12+ and [Node.js](https://nodejs.org) 22.22+).

Then:

1. **On the computer connected to the TV**, open http://localhost:3000, pick a quiz (or upload your own) and press **Start a game**. Click **Start the show** once to turn on sound and full screen.
2. **Teams** scan the QR code on the title screen, or open the address shown and enter the room code. One phone per team.
3. **You** can run everything from your own phone: Menu on the TV shows a QR code for the remote. Keep that one to yourself; it shows the answers.

Allow Python through the Windows firewall on private networks the first time, or phones can't connect.

## How a round works

Questions → **Pens down** (answers lock, teams are paired up to mark each other) → answer slides: each reveal lets the paired team mark ✓/✗ on their phone → the marked team can dispute → the quizmaster rules on the big screen. Marks fill in the scores automatically. Teams without phones can be added as paper teams and scored by hand.

## Write your own quiz

The easiest way is the **quiz builder** at `/build` (linked from the start page): write the rounds in your browser, see each question as the TV will show it, fix anything it flags, then start a game or download the file. Your draft is kept in that browser until you start a new one.

Under the hood, quizzes are JSON files. You can also copy [`quizzes/classic.json`](quizzes/classic.json), change the questions, and either drop it into `quizzes/` (it appears in the list) or upload it on the start page. Every quiz is checked; if something is wrong you get a list of exactly what and where. A broken file in `quizzes/` is skipped with a warning, never fatal.

Round kinds: `standard` (question + answer), `flag` (a built-in flag, or emoji + question), `music` (a tune played live, or emoji clues; bonus point for the artist), `emoji`, `vowels` (missing-vowels puzzles) and `versus` (which came first, A or B). The rules and limits are in [`backend/trivvoly/quiz.py`](backend/trivvoly/quiz.py).

## Develop

```
# Backend (Python + FastAPI)
cd backend
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"      # macOS/Linux: .venv/bin/pip
.venv\Scripts\python -m pytest              # tests (TEST_DATABASE_URL=postgresql+psycopg://... runs them on Postgres)
.venv\Scripts\python -m trivvoly            # server on :3000 (--reset clears saved games)

# Frontend (React + TypeScript + Vite), in a second terminal
cd frontend
npm install
npm run dev          # http://localhost:5173, forwards /api to the server on :3000
npm run typecheck
npm test             # frontend tests (Vitest)
npm run build        # into frontend/dist, which the server then serves on :3000
npm run gen:types    # after changing backend/trivvoly/quiz.py or views.py
```

### How it fits together

- **The server owns every game.** Each room's state (slide, timer, reveals, answers, marks, disputes, scores) lives in [`backend/trivvoly/game.py`](backend/trivvoly/game.py). The TV, the team phones and the quizmaster's remote each hold one WebSocket, send commands, and draw the view the server sends them. Teams only ever receive public information.
- **Backend** ([`backend/trivvoly/`](backend/trivvoly/)): `quiz.py` (the quiz format, Pydantic), `game.py` (state machine and views), `marking.py` (auto-mark suggestions), `moderation.py` (offensive-word filter), `rooms.py` + `db.py` (rooms, accounts and saved quizzes, with SQLAlchemy: SQLite or Postgres), `accounts.py` + `google.py` + `mail.py` (signing in and saved quizzes), `admin.py` + `switches.py` (the admin area), `observe.py` (logs, request IDs, metrics), `app.py` + `security.py` (REST, WebSockets, protections).
- **Frontend** ([`frontend/src/`](frontend/src/)): `pages/landing`, `pages/play` (team phone), `pages/remote` (quizmaster phone), `pages/show` (the TV: slides, sound, lights, panels), `pages/build` (quiz builder), `pages/account` (sign in, your quizzes). Shared code is in `lib/`; all types for what the server sends are generated from the backend into `lib/contract.gen.ts`.
- **Styling:** the existing screens use plain CSS scoped per screen on shared tokens (`styles/tokens.css`); Tailwind utilities are available for new screens.

## Accounts

Nobody needs an account to play or host. Quizmasters can sign in, with Google or a link sent by email, to keep their quizzes in their account: the quiz builder saves as you type, and saved quizzes appear on the start page ready to play. On your own machine, email sign-in needs no setup (the link is printed in the server's terminal).

Admins (the addresses in `ADMIN_EMAILS`) get an admin area at `/admin`: live games and accounts, bans, switches to pause new games or sign-ups, a notice on the start page, recent problems and an admin log. See [docs/HOSTING.md](docs/HOSTING.md).

## Hosting it online

**[docs/DEPLOY.md](docs/DEPLOY.md)** goes step by step from nothing to a live site on a small Hetzner server: HTTPS (Caddy), Postgres, nightly backups, a firewall and automatic security updates, set up by [`deploy/setup-server.sh`](deploy/setup-server.sh) and updated with [`deploy/deploy.sh`](deploy/deploy.sh). [docs/HOSTING.md](docs/HOSTING.md) has every setting.

## Safety

Built for strangers on the internet: quizzes are validated data and every piece of text is escaped; quizmaster secrets travel in the link's `#` part and become HttpOnly cookies scoped to one room, and are stored only as hashes (team logins too); every WebSocket's origin is checked; pages send a strict Content-Security-Policy; requests and messages are size- and rate-limited; team names and dispute reasons are filtered for offensive words; rooms (with all their data) expire after a few hours or when the quizmaster ends the game. Accounts: sign-in sessions and emailed links are random tokens stored only as hashes; links work once for 15 minutes; Google sign-in runs on the server with PKCE, state and nonce checks; every account can be deleted with everything in it. See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/HOSTING.md](docs/HOSTING.md).

## Credits

Offensive-word list from [obscenity](https://github.com/jo3-l/obscenity) (MIT), exported to [`backend/trivvoly/data/profanity_en.json`](backend/trivvoly/data/profanity_en.json).

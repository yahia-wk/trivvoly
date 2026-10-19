# Trivvoly

> Pens down! A live trivia night for a TV and everyone's phones.

A pub-quiz show for a TV or projector, with phones for the teams and a phone remote for the quizmaster: free-text answers, jokers, teams marking each other's answers, and disputes ruled on the big screen. Many games can run at once, each in its own room.

## Run it

Needs [Node.js](https://nodejs.org) 20 or newer.

```
npm install          # first time only (start-trivia.bat does this for you)
npm start            # or double-click start-trivia.bat
npm test             # run the tests
```

Then:

1. **On the computer connected to the TV**, open http://localhost:3000, pick a quiz (or upload your own) and press **Start a game**. Click **Start the show** once to turn on sound and full screen.
2. **Teams** scan the QR code on the title screen, or open the address shown and enter the room code. One phone per team.
3. **You** can run everything from your own phone: Menu on the TV shows a QR code for the remote. Keep that one to yourself; it shows the answers.

Allow Node.js through the Windows firewall on private networks the first time, or phones can't connect.

`node server.js --reset` clears all saved games. `node server.js --quiz path/to/quiz.json` adds a quiz from somewhere else to the list.

## How a round works

Questions → **Pens down** (answers lock, teams are paired up to mark each other) → answer slides: each reveal lets the paired team mark ✓/✗ on their phone → the marked team can dispute → the quizmaster rules on the big screen. Marks fill in the scores automatically.

## Write your own quiz

Quizzes are JSON files. Copy [`quizzes/classic.json`](quizzes/classic.json), change the questions, and either drop it into `quizzes/` (it appears in the list) or upload it on the start page. Every quiz is checked; if something is wrong you get a list of exactly what and where. A broken file in `quizzes/` is skipped with a warning, never fatal.

Round kinds: `standard` (question + answer), `flag` (a built-in flag, or emoji + question), `music` (a tune played live, or emoji clues; bonus point for the artist), `emoji`, `vowels` (missing-vowels puzzles) and `versus` (which came first, A or B). See [docs/ROADMAP.md](docs/ROADMAP.md#quiz-file-format-phase-0) for the format and [`shared/quiz-format.js`](shared/quiz-format.js) for every rule and limit.

## Hosting it online

Trivvoly runs as one Node process; a [Dockerfile](Dockerfile) is included. Run it behind your provider's HTTPS and set:

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 3000). |
| `PUBLIC_URL` | The site's address, e.g. `https://trivvoly.com`. Used for join links and QR codes. |
| `TRUST_PROXY=1` | Behind exactly one proxy/load balancer (the usual hosting setup): take the client address from the last `X-Forwarded-For` entry and HTTPS from `X-Forwarded-Proto` (set in the Dockerfile). Don't set it when the server is reachable directly, or clients could fake their address. |
| `NODE_ENV=production` | Cache pages in memory (set in the Dockerfile). |
| `TRIVVOLY_STATE` | Where running games are saved so a restart doesn't end them. Point it at a persistent volume. |
| `TRIVVOLY_MAX_ROOMS`, `TRIVVOLY_MAX_ROOMS_PER_IP` | Capacity limits (defaults 300 and 5). |

`GET /healthz` answers `ok` for health checks.

## Safety

Built for strangers on the internet: quizzes are validated data, every piece of text is escaped, quizmaster secrets travel in the link's `#` part and become HttpOnly cookies scoped to one room, team logins are cookies too, pages send a strict Content-Security-Policy, requests are size- and rate-limited, team names and dispute reasons are filtered for offensive words, and rooms (with all their data) expire after a few hours or when the quizmaster ends the game. See [docs/ROADMAP.md](docs/ROADMAP.md#safety-applies-from-phase-1-onwards-designed-in-from-phase-0).

## Files

| Path | What it is |
| --- | --- |
| `server.js` | Routes: start page, rooms, pages, live updates (Server-Sent Events). |
| `lib/game.js` | One game: teams, answers, peer marking, disputes. Checks everything browsers send. |
| `lib/rooms.js` | Rooms: codes, quizmaster keys, expiry, saving. |
| `lib/http.js` | Body limits, cookies, security headers, rate limits. |
| `lib/quizzes.js` | Loads built-in quizzes and checks uploads. |
| `lib/moderation.js` | Offensive-word filter for team names and dispute reasons. |
| `public/index.html` | Start page: join with a code, or host a quiz. |
| `public/show.html` | The show on the big screen. |
| `public/play.html` | Team phone page. |
| `public/remote.html` | Quizmaster phone remote. |
| `public/claim.html` | Turns a quizmaster link into a login cookie. |
| `quizzes/` | Built-in quizzes. |
| `shared/` | Quiz format rules and the built-in flags, used by the server and the pages. |
| `docs/ROADMAP.md` | The plan for taking Trivvoly online. |

# Trivvoly roadmap: from living-room LAN game to online service

Trivvoly today runs on one PC for one game: a big-screen show, team phones, peer marking, disputes and a quizmaster phone remote. The goal is to run the same game online for anyone: a quizmaster opens a room, players join with a QR code or room code, and quizzes come from a question bank or are written by users.

## Decisions so far

| Question | Decision |
| --- | --- |
| Who is it for? | Friends **and** anyone on the internet. Safety is a priority, not an afterthought. |
| Money | Free. No charging for now; ads or similar may come later, but they don't shape the design today. |
| Game feel | Keep the current mechanics and vibe: TV show, free-text answers, jokers, peer marking, disputes ruled on the big screen. Scale it, don't turn it into a Kahoot clone. Multiple-choice is added later as one more question type. |
| Self-hosting | Keep it. "Run it free on your own PC, or use the hosted version." |
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
| **1** | Rooms: many games per server, room codes + QR, per-room host secrets, room expiry, choose a built-in quiz or upload a quiz file. Deploy one server online with HTTPS. No accounts yet. | Next |
| **2** | Quizmaster accounts, quiz builder, saved quizzes, import from spreadsheet/JSON. Postgres. | |
| **3** | Question bank: categories, difficulty, "generate a quiz", multiple-choice question type with automatic scoring. | |
| **4** | Community: public quizzes, sharing, ratings, reporting, moderation tools. | |

## Where quizzes live

- **The quiz format is the contract; files are temporary storage.** `shared/quiz-format.js` is what every quiz must pass, wherever it comes from. The `quizzes/` folder holds only built-in quizzes and self-hosters' quizzes.
- **Online (Phase 2): Postgres.** A `questions` table (one row per question: type, category, difficulty, tags, author, visibility, moderation status, and the per-type content as JSONB in the same shape as the file format) so the bank is searchable and questions can be shared between quizzes; a `quizzes` table (title, owner, settings) with ordered rounds referencing questions.
- **Every write is validated** with the same rules: the builder, imports, the API.
- **Rooms snapshot their quiz at start**, so editing a quiz never disturbs a game in progress.
- **JSON files stay as import/export** (backup, sharing, moving between servers) and the `format` number lets old files be migrated.

## Failure isolation

One bad quiz must never affect anyone else.

- **On save or upload:** rejected with the list of problems shown to the author; never stored.
- **On room start:** if a stored quiz fails validation (e.g. after a format change), only that room refuses to start, with a message to the quizmaster.
- **Built-in quizzes at startup:** an invalid file is skipped with a warning; the server starts with the rest. (Phase 0 still exits on a bad quiz because it loads exactly one, chosen by whoever runs it; this changes in Phase 1.)

## Safety (applies from Phase 1 onwards, designed in from Phase 0)

- **Content is data, never code.** Quiz files are validated against a strict format: only known fields, length limits, limited counts. Unknown fields are dropped. Images and flags come from a built-in library by id, so a quiz can never inject markup or scripts. Every piece of quiz or player text is HTML-escaped when shown.
- **Secrets.** Quizmaster links carry an unguessable secret per room. The show and remote pages (which contain answers) are only served with that secret. Answers never reach player phones before the reveal.
- **Abuse limits.** Rate limits on joining, answering and room creation; caps on teams per room, rooms per IP and request sizes; room codes long enough not to be guessed by scanning.
- **Names and text from players.** Profanity filter on team names and dispute reasons; the quizmaster can remove a team at any time.
- **Public content (Phase 4).** Report button, review queue, ability to unpublish; private quizzes are never listed.
- **Privacy.** Collect as little as possible: no player accounts, quizmaster email only, no tracking. A short privacy page. Delete room data when a room expires.
- **Transport.** HTTPS only in the hosted version; security headers (CSP, no framing).

## Hosting (Phase 1)

A server that stays running (live connections rule out "serverless" hosts like Vercel): a small VPS (Hetzner, DigitalOcean) or a platform like Fly.io, Railway or Render, plus a managed Postgres free tier (Neon, Supabase) from Phase 2. Rough hobby-scale cost: about $5–25 a month plus the domain (prices to be checked). One Node process should handle hundreds of concurrent rooms; scaling to several servers (shared state via Redis) only if it gets popular.

## Quiz file format (Phase 0)

See [`quizzes/classic.json`](../quizzes/classic.json) for a full example and [`shared/quiz-format.js`](../shared/quiz-format.js) for the exact rules. In short:

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

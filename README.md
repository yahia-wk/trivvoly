# Trivvoly

> Pens down! A live trivia night for a TV and everyone's phones.

A pub-quiz show for a TV or projector, with phones for the teams and a phone remote for the quizmaster. No dependencies: just Node.js.

## Run it

```
node server.js                              # or double-click start-trivia.bat
node server.js --reset                      # start a brand-new game (keeps the same host key)
node server.js --quiz quizzes/my-quiz.json  # play a different quiz
npm test                                    # run the tests
```

The server prints three links:

- **Host**: open it on the computer connected to the TV, then click **Start the show** once (turns on sound and full screen).
- **Players**: teams open it on their phones (the title slide also shows a QR code). One phone per team.
- **Remote**: open it on your own phone to run everything: slides, timer, marking, disputes, scores and settings. Menu on the TV can show it as a QR code too.

Keep the host and remote links private: they include the answers. Allow Node.js through the Windows firewall on private networks the first time, or phones can't connect. Set `PORT` to use something other than 3000.

## Write your own quiz

Quizzes are JSON files in [`quizzes/`](quizzes/). Copy [`quizzes/classic.json`](quizzes/classic.json), change the questions, and start the server with `--quiz`. Every quiz is checked when the server starts; if something is wrong you get a list of exactly what and where.

Round kinds: `standard` (question + answer), `flag` (a built-in flag, or emoji + question), `music` (a tune played live, or emoji clues; bonus point for the artist), `emoji`, `vowels` (missing-vowels puzzles) and `versus` (which came first, A or B). See [docs/ROADMAP.md](docs/ROADMAP.md#quiz-file-format-phase-0) for the format and [`shared/quiz-format.js`](shared/quiz-format.js) for every rule and limit.

## Files

| Path | What it is |
| --- | --- |
| `public/show.html` | The show on the big screen: slides, sound, timer, scores, answers panel, disputes. |
| `public/play.html` | Team phone page: join, answer, play the joker, mark another team, dispute marks. |
| `public/remote.html` | Quizmaster phone remote. |
| `quizzes/` | Quiz files. `classic.json` is the default. |
| `shared/quiz-format.js` | The quiz file rules, used to validate every quiz. |
| `shared/flags.js` | Built-in flag pictures that quizzes refer to by name. |
| `server.js` | Serves the pages, loads the quiz, keeps the game state in `trivia-state.json`, and relays live updates (Server-Sent Events). |
| `docs/ROADMAP.md` | The plan for taking Trivvoly online. |

## How a round works

Questions → **Pens down** (answers lock, teams are paired up to mark each other) → answer slides: each reveal lets the paired team mark ✓/✗ on their phone → the marked team can dispute → the quizmaster rules on the big screen. Marks fill in the round scores automatically.

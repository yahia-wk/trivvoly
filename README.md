# Trivia Night

A pub-quiz show for a TV or projector, with phones for the teams and a phone remote for the quizmaster. No dependencies: just Node.js.

## Run it

```
node server.js            # or double-click start-trivia.bat
node server.js --reset    # start a brand-new game (keeps the same host key)
```

The server prints three links:

- **Host**: open it on the computer connected to the TV, then click **Start the show** once (turns on sound and full screen).
- **Players**: teams open it on their phones (the title slide also shows a QR code). One phone per team.
- **Remote**: open it on your own phone to run everything: slides, timer, marking, disputes, scores and settings. Menu on the TV can show it as a QR code too.

Keep the host and remote links private: they include the answers. Allow Node.js through the Windows firewall on private networks the first time, or phones can't connect. Set `PORT` to use something other than 3000.

## Files

| File | What it is |
| --- | --- |
| `trivia-night.html` | The show on the big screen: slides, questions (`ROUNDS`, `TIEBREAKERS`, `RULES` near the top), sound, timer, scores. Also works on its own, opened straight from disk, without phones. |
| `player.html` | Team phone page: join, answer, play the joker, mark another team, dispute marks. |
| `remote.html` | Quizmaster phone remote. |
| `server.js` | Serves the pages, keeps the game state in `trivia-state.json`, and relays live updates (Server-Sent Events). |

## How a round works

Questions → **Pens down** (answers lock, teams are paired up to mark each other) → answer slides: each reveal lets the paired team mark ✓/✗ on their phone → the marked team can dispute → the quizmaster rules on the big screen. Marks fill in the round scores automatically.

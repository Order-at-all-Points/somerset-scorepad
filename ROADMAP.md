# Some-R-Set — Development Roadmap

## Shipped (production: somerset-scorepad.vercel.app)
- Single-game score pad: bidding/trump entry (two-step), set penalty (subtract bid, can go negative), shoot-the-moon win rule, clockwise dealer rotation with seat diagram, editable player/seat names, New Game.
- **Game History** — completed games archived with rosters, winner, score, date; tap to expand the hand-by-hand log; delete entries.
- **Tournament mode**
  - Player-count picker (even players, min 6) → name entry with Quick-add name book (per device, editable, deduped).
  - Random team draw (2 per team); odd team counts allowed (random byes auto-advance).
  - **Single Elimination** bracket with flowchart diagram; pick winner manually or play in-app.
  - **Double Elimination** format (winners + losers brackets, grand final).
  - **Round Robin** format (standings table + schedule grid).
  - Per-match games (concurrent, independent); play/resume a match, winner auto-advances and archives to History.
  - Rematch (same teams) / redraw (same players) at tournament end.
- **Best-of Series mode (4 players / 2 teams).** A lightweight alternative to a bracket: enter 4 names, split into 2 teams (random draw or pick partners), choose Best of 3 / 5 / 7, and play games until a team clinches the majority. Live scoreboard (game wins + game-by-game list), each game played/resumed in-app and archived to History, undo the most recent game, rematch/redraw at the end. Reuses the tournament match-play, locking, sync, and History machinery (`format: "series"`), so it syncs across devices via the same join-code flow.
- **Shared backend (multi-device tournaments)** via Firebase Realtime Database — live simultaneous logging across phones, siloed per tournament, joined via a short friendly join code. Per-device name book stays local.

## Planned — in priority order
*(nothing currently planned)*

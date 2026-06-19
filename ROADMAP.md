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
- **Shared backend (multi-device tournaments)** via Firebase Realtime Database — live simultaneous logging across phones, siloed per tournament, joined via a short friendly join code. Per-device name book stays local.

## Planned — in priority order
*(nothing currently planned)*

## Future — after all other functionality is complete
- **Best-of Series mode (for 4 players / 2 teams).** Instead of a bracket, play a best-of-N series (best-of-3/5/7 — any odd number of games); track game wins and declare a series winner. Use case: a 4-player gathering where a full tournament doesn't make sense.

# Some-R-Set — Development Roadmap

## Shipped (production: somerset-scorepal.vercel.app)
- Single-game score pad: bidding/trump entry (two-step), set penalty (subtract bid, can go negative), shoot-the-moon win rule, clockwise dealer rotation with seat diagram, editable player/seat names, New Game.

## In the dev build (dev/index.html → separate dev URL)
- **Game History** — completed games archived with rosters, winner, score, date; tap to expand the hand-by-hand log; delete entries.
- **Tournament mode**
  - Player-count picker (even players, min 6) → name entry with Quick-add name book (per device, editable, deduped).
  - Random team draw (2 per team); odd team counts allowed (random byes auto-advance).
  - Single-elimination bracket with flowchart diagram; pick winner manually or play in-app.
  - Per-match games (concurrent, independent); play/resume a match, winner auto-advances and archives to History.
  - Rematch (same teams) / redraw (same players) at tournament end.

## Planned — in priority order
1. **Shared backend (multi-device tournaments).** Live simultaneous logging across phones for one tournament, siloed per tournament, joined via a **short friendly join code**. Free backend-as-a-service (Firebase/Supabase) + a small server-side rate-limit guard so short codes can't be brute-forced. Per-device name book stays local.
2. **Double Elimination** format (winners + losers brackets, grand final).
3. **Round Robin** format (standings table + schedule grid).

## Future — after all other functionality is complete
- **Best-of Series mode (for 4 players / 2 teams).** Instead of a bracket, play a best-of-N series (best-of-3/5/7 — any odd number of games); track game wins and declare a series winner. Use case: a 4-player gathering where a full tournament doesn't make sense.

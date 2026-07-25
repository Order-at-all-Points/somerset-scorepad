# Diagnosing a cross-device History / Stats discrepancy

**Use this when** two people who played the same games see different numbers — different win/loss
records, a game one person has and another doesn't, or a game both have but with a different winner.

The short version: **every discrepancy is one or more records disagreeing on `matchUid`.** Find which
ones, decide which copy is right, then let the app repair itself. Don't hand-edit anything.

---

## Ground rules

- **Scope every read to a specific known uid or sync code.** Never scan `/users/*/history` looking for
  something by name — that's ~190 real people's game records. Same convention
  `stress-test/audit-orphaned-profiles.js` follows. If you don't know a uid, ask for the `profileId`
  (visible in the app) and resolve it in step 1, or get the uid from Firebase Console → Authentication.
- **`npx firebase-tools` uses admin credentials and bypasses the security rules entirely.** This is the
  single easiest way to waste an hour: a node you can read fine with `database:get` may be completely
  unreachable to the app. To test what the *app* can see, use an unauthenticated REST read (the
  `tournaments/$code` read rule has no `auth != null` clause) — see step 5.
- **The global `firebase` binary isn't installed**; always `npx firebase-tools`.
- Working files go in the scratchpad, never the repo. No game data is ever committed.

---

## Step 1 — Resolve people to uids

Players know their `profileId` (`sp…`), not their uid.

```bash
npx firebase-tools database:get "/statsProfiles/<profileId>/ownerUid" --project somerset-scorepad
```

## Step 2 — Pull each person's history

```bash
npx firebase-tools database:get "/users/<uid>/history" \
  --project somerset-scorepad --output <name>-history.json
```

## Step 3 — Diff by `matchUid`

This is the step that finds the problem. `matchUid` (`<code>:<tourneyId>:<slot>`) is stable across every
device that archived the same match; record `id` is not.

```js
const idx = h => { const m = {}; Object.values(h||{}).forEach(r => { if (r.matchUid) m[r.matchUid] = r; }); return m; };
const sig = r => r.winner + "|" + (r.totals||[]).join(",") + "|" +
  r.deals.map(d => [d.bid, d.bidTeam, d.bidderSeat, d.pts.join("/")].join(":")).join(";");
// for each matchUid: who has it, and do their signatures agree?
```

Three things to look for:

| symptom | meaning |
|---|---|
| a `matchUid` missing from someone | they were offline when it finished — **back-fill** case |
| signatures differ on a shared `matchUid` | a deal was corrected after some devices archived — **reconcile** case |
| everyone agrees | the discrepancy isn't in the records; check name merges/aliases in Stats |

## Step 4 — Establish ground truth

The live sync node is authoritative, not majority vote:

```bash
npx firebase-tools database:get "/tournaments/<code>" --project somerset-scorepad --output t.json
```

`games[N].completedGame.deals` and `games[N].winner` are what actually happened. `games[N].archivedId`
names the record id of the device that wrote that state.

Replay a game's deals with the app's own scoring rules (`dealDelta` / `dealResult` / `isDealSet` /
`isMoonMade` in `index.html`) to confirm the totals follow from the deals. A deal whose `pts` don't sum
to 14 is corrupt; two deals with the **same `id`** but different values are a concurrent-edit conflict.

## Step 5 — Check the session is still reachable *by the app*

Admin reads always work. What matters is the rules:

```bash
DB=https://somerset-scorepad-default-rtdb.firebaseio.com
curl -s -o /dev/null -w "%{http_code}\n" "$DB/tournaments/<code>.json"   # 200 readable / 401 expired
```

`tournaments/$code` runs on **two clocks** (see `FIREBASE_SETUP.md`): writable 48h, readable 30d, both
from `_createdAt`. A `401` here means the repair path is closed and the record can't be fixed through
the app at all.

---

## Repairing

**Never hand-edit a history record, and never tell someone to delete the bad one.** Deletion writes a
tombstone keyed on `matchUid` (`index.html`, `historyTombstones`), which suppresses the *corrected*
copy too — the game vanishes instead of being fixed. Import doesn't help either: `importHistoryFile`
dedups on record `id`, not `matchUid`, so importing someone else's backup adds a second copy of every
shared game rather than correcting one.

The supported repair is to **rejoin the old code** and let the app reconcile:

1. Tournament tab → **End Game / Leave Game** (there's no "Join with code" affordance while a
   tournament is loaded). This is local only — `saveTourney()` with a null tourney just clears
   localStorage and detaches the listener; it never touches `/tournaments/<code>`, so nobody else is
   affected.
2. **Join with the old code.** No identity tap needed — `autoIdentifyFromDeviceName()` matches the saved
   device name against the roster and re-identifies silently, which is what fires the repair.
3. **Wait ~5–10 seconds** and confirm in History before leaving. Three things happen at different
   speeds: the local record is fixed synchronously, the cloud copy needs a round-trip, and the
   stats-sharing digest is on a **2 s debounce** (`publishMyDigestSoon`). The digest is what everyone
   *else* sees, so leaving too early leaves them looking at stale numbers.

The session will show a grey **"Archived: read-only"** pill rather than "Live" — correct, and History
still syncs through it.

Back-filled records carry the **archive** time, not when the game was played, so a game caught up days
later appears in History under today's date. There's no way to recover the true time; the live node
doesn't store it.

---

## What's already defended

| shipped | guarantees |
|---|---|
| `reconcileArchivedRecord` (`a10f8cb`) | an archived record adopts later corrections to its deals on any synced snapshot, in place, no duplicate |
| `dirtyHistoryIds` (`a10f8cb`) | a reconciled record is re-pushed to the cloud — `syncHistoryToCloud` otherwise skips ids it has already sent |
| 48h write / 30d read split (`c23b4aa`) | the repair window outlives the play window, so a discrepancy found days later is still fixable |
| `sessionFrozen` (`4ae17b6`) | a past-write-window session reads as archived instead of failing writes with "Someone else just started entering this hand." |

Regression coverage lives in `stress-test/scenarios/casual-shared.js`:
`deciding-deal-correction-propagates`, `deciding-deal-correction-repairs-on-rejoin`,
`missed-games-backfill-on-rejoin`, `frozen-session-reads-as-archived`. All need the emulators
(see the `verify` skill).

---

## Gotchas that have cost real time

- **`storage.readKey().value` is null for `authUid`** — it's stored as a raw string, not JSON. Use
  `.raw`. Every scenario except one new one got this right; the odd one out silently compared `null`.
- **Comparing deals with `JSON.stringify` gives false positives.** A record that round-trips through
  Firebase comes back with keys in sorted order. Compare field by field.
- **`cleanup-expired.js`'s `TOURNAMENT_TTL_MS` must track the *read* window**, not the write one.
  Set to 48h it would delete exactly the nodes the repair path depends on.
- **`tourney._createdAt` can be an object, not a number** — several call sites set it to a
  `ServerValue.TIMESTAMP` sentinel that stays an object locally until the server echoes back. Anything
  reading it must treat non-numeric as "unknown".
- **`tournament.bestOf` and `championship` drift per device** on shared series and always have. Inert
  under the current `isTournamentRecord()` (any `format: "series"` record is a Standard game regardless
  of `bestOf`), so it's noise in a diff — not the bug you're looking for.

---

## Worked example — 2026-07-24

Four players, two devices showing different career records. Keith's device had Keith at 4W–9L, Tom's had
3W–10L, over what should have been the same 13 games.

The diff found **exactly one** divergent record, `4TF2R3:1784507177834:series_3`. Deals #0–#5 were
byte-identical everywhere. Deal #6 — same deal `id`, so one object edited concurrently, not two deals:

| | deal #6 | totals | winner |
|---|---|---|---|
| Keith, Paige | `bid 6, pts [14,0]` (made) | We **53** – They 45 | We |
| Tom, Cynthia | `bid 7, pts [6,8]` (**set**, −7) | We 32 – They **53** | They |

`/tournaments/4TF2R3/games[3]` held `bid 6 / [14,0]`, `winner: 0`, `archivedId` = Keith's record id, so
Keith and Paige were right. Timestamps explained it: the deal was first entered as the losing version,
Tom's and Cynthia's devices auto-archived within 0.3 s, the deal was then corrected, and only the two
devices that hadn't archived yet saw the fix.

That one deal accounted for the entire discrepancy — including Keith's `sets` count, since he was the
bidder on it.

A second, unrelated problem surfaced in the same diff: Paige was missing two records outright
(`V36ZCV:…:series_3`, `series_4`) — the back-fill case, from being offline.

**Repair:** all three rejoined their old codes. Verified afterwards that all 15 matches agreed across all
four devices on winner, totals and every deal, that all four devices computed identical stats for all
four players, and that all four published digests matched.

**Cost of the read window being 48h at the time:** `4TF2R3` had already expired when the discrepancy was
found, and had to be temporarily reopened by bumping `_createdAt` before anyone could repair. That is
what motivated the 30-day read window.

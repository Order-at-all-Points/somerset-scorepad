# Cloud Sync / Shared History & Stats — Stress Investigation

**Started:** 2026-07-16
**Branch:** `dev` @ `488fe59`
**Scope:** Cloud Backup (device linking), shared History merge, Stats Sharing (digests, grants, follows).
**Goal:** find pre-launch bugs, root-cause each, then map how they interact before fixing anything.

---

## Method

1. Read the full sync/linking/sharing surface in `index.html` + the security rules in `FIREBASE_SETUP.md`.
2. Baseline the existing stress suite (42 scenarios).
3. Reproduce each hypothesis against **local Firebase emulators** (never production — see rate-limit lore in
   `.claude/skills/verify/SKILL.md` and the memory note).
4. Root-cause; do **not** fix yet.
5. Only once the list is complete: analyze interactions and fix-ordering.

## Coverage gap that motivates this work

Stats Sharing shipped 2026-07-15 with **no durable stress-suite scenario** — it was verified once by a
one-off script (`.claude/skills/verify/examples/verify-sharing-emulator.js`). `stress-test/scenarios/`
has `device-linking.js` and `sync-cross-cutting.js` but nothing for `statsProfiles`/grants/follows.
That is the least-defended surface and where I'm concentrating.

---

## Architecture model (as built)

**Three separate cloud state trees:**

| Tree | Owner | Enforcing? | Restored from |
|---|---|---|---|
| `users/<uid>/history` | one device | yes (single-writer) | own uid only |
| `people/<personId>/linkedUids` + `personOf/<uid>` | person-group | yes | server |
| `statsProfiles/<pid>/allowed/<theirPid>` | person (shared) | **yes — this is the access control** | never |
| `users/<uid>/sharePeers` | one device | no (display/restore copy) | own uid only |

Key asymmetry: **`allowed/` is per-PERSON and enforcing; `sharePeers` is per-DEVICE and advisory.**
`restorePeersFromCloud()` (index.html:2272) reads only `users/<authUid>/sharePeers` — it never merges
linked devices' peer rosters, unlike history which fans out across `linkedUids`. Several findings below
fall out of that asymmetry.

---

## Findings

Status legend: `HYPOTHESIS` → `CONFIRMED` (reproduced) / `REJECTED` (disproved by test).

### F1 — Turning off Cloud Backup reports "Stats Sharing: Off" while stats stay published and readable — **CONFIRMED**
**Severity:** High (privacy — the UI actively asserts a false statement, and offers no way to make it true)
**Repro:** `scratchpad/f1-backup-off-leaves-sharing-live.js` (emulators + real rules). Deterministic — no race, no offline.

Sequence: Alice + Bob both back up + share → shared game → mutual grants → **Alice turns off Cloud Backup**.

Observed (rules-enforced reads from Bob's own authenticated session):

```
PASS  UI CLAIM: Display sheet reports Stats Sharing 'Off'          [row shows: Off]
PASS  UI: master sharing toggle is NOT rendered (no way to revoke)  [toggle count=0]
PASS  REALITY: Alice's grant to Bob still exists in the cloud       [{"spXDLDTTF4ZCPL":true}]
PASS  REALITY: Alice's published digest still exists in the cloud   [name=Alice games=1 highlights=longestGame,nailbiter]
FAIL  *** BUG: Bob can STILL read Alice's digest after she turned backup off ***   [STILL READABLE: {...}]
FAIL  *** BUG: Alice's full highlight GAME records still readable by Bob ***       [exposed: longestGame,nailbiter]
```

**Root cause.** The user-facing state is computed from *connectivity*, not from *what is actually published*:

```js
// index.html:4364 — Display sheet "Stats Sharing" row
el("span", { class:"settings-row-state disp" }, [statsSharingOn() ? "On" : "Off"])

// index.html:2093-2094
function sharingReady() { return cloudSyncEnabled && !!authUid && (!!fb || initFb()); }
function statsSharingOn() { return autoShare && sharingReady(); }
```

`unlinkDevice()` (1409) sets `cloudSyncEnabled = false` but deliberately keeps `autoShare` and the peer
roster, and explicitly leaves the digest and grants server-side ("merely going stale", 1424). So
`statsSharingOn()` flips to false purely because `cloudSyncEnabled` did — the row renders "Off" while
`allowed/` and `/digest` are untouched and fully readable.

Three failures compound:
1. **Display conflates "can't reach the cloud" with "not sharing."** Same expression is used for both.
2. **`unlinkDevice()` tears down listeners but never revokes.** It is the only teardown that skips the
   `allowed/` map.
3. **The sharing sheet gates the master toggle on `cloudSyncEnabled` (4406).** With backup off, the sheet
   renders only a "Set up Cloud Backup" button — so the one control that *would* revoke is unreachable
   exactly when a user who just turned backup off would go looking for it.

Note the same expression causes a benign flicker: `authUid` is null for the first ~second of *every* boot
(deliberately never seeded from cache, 2000-2007), so the row reads "Off" briefly on every launch. Same
root cause, cosmetic symptom — a useful tell that the state is being derived from the wrong thing.

### F6 — If the profile's minting device unlinks, sharing becomes permanently unrevocable — **CONFIRMED**
**Severity:** Critical (privacy, **unrecoverable** — no device can ever fix it, and neither can a client-side patch)
**Repro:** `scratchpad/f6-unrevocable-after-owner-unlink.js`

Alice's phone (A1) mints profile P; her tablet (A2) adopts it. Bob is granted. A1 then unlinks.

```
PASS  Profile's ownerUid is A1 (the phone)
PASS  SETUP: Alice's digest is published before the unlink     [name=Alice games=1]
PASS  SANITY: A2 can write the shared profile while A1 is linked   [ok]
PASS  A1 unlinked: personOf/<a1uid> is gone                    [null]
FAIL  *** BUG: Bob's grant survives even A2's master-off (unrevocable) ***   [{"spAFAPKJTR5BXN":true}]
FAIL  *** ROOT CAUSE: A2's revoke write is rejected by the rules ***          [denied:PERMISSION_DENIED]
FAIL  *** BUG: Bob still reads Alice's digest — no device can ever stop him ***
        [STILL READABLE: name=Alice games=1 highlights=bestWin,longestGame,nailbiter]
FAIL  Context: A2 also permanently locked out of publishing its own digest    [denied:PERMISSION_DENIED]
```

**Root cause.** The `statsProfiles/$profileId` write rule authorizes via the *owner's* identity:

```
".write": "auth != null && ((!data.exists() && newData.child('ownerUid').val() === auth.uid)
        || (data.exists() && (data.child('ownerUid').val() === auth.uid
        || (root.child('personOf').child(auth.uid).val() != null
            && root.child('personOf').child(auth.uid).val()
               === root.child('personOf').child(data.child('ownerUid').val()).val()))))"
```

A non-owner device authorizes only through `personOf[auth.uid] === personOf[ownerUid]`. `unlinkDevice()`
(1417-1419) removes `personOf/<ownerUid>`, so that clause's right-hand side becomes `null` forever. The
first clause never applied to A2. Result: **A2 can never write P again** — not the digest, and critically
not `allowed/`. The grant is frozen open.

**Precision correction (2026-07-17):** my first write-up said "no device can *ever* revoke". That is too
strong, and the distinction matters for the production audit. The `ownerUid` clause is **unconditional**, so
the ex-owner device (A1) technically retains write access even after unlinking. But it is unrevocable in
every sense that reaches a user: A1's own UI reports sharing as Off (F1) and hides the master toggle, and
the only route back — re-enable backup, re-enable sharing — **re-grants every peer before it could revoke
them**. So no device the person still uses can revoke, and it becomes permanent the moment the ex-owner
device is wiped, reinstalled, or given away — which is frequently the very reason someone unlinks. The
reproduced fact is exactly what the guard asserts: **the person's remaining device is locked out.**

This is the known v1 limitation "original-ownerUid device unlinking locks remaining devices out of digest
writes" — but its *stated* blast radius (stale digest) is wrong. The real blast radius is **permanent,
unrevocable exposure of the digest and its full highlight game records**, which is a different severity class.

Note it is unrecoverable **by design of the data, not just the code**: any profile already orphaned in
production stays orphaned. A client fix cannot reach it; only a rules change plus an admin-side cleanup can.
→ **Action item: check production for already-orphaned profiles** (`statsProfiles/*` whose `ownerUid` has
no `personOf` entry but which still have a non-empty `allowed/`).

### F1b — Revocation is fire-and-forget; a failed revoke is never retried — **SUBSUMED, not independently reproduced**
**Severity:** n/a — the reachable trigger turned out to be F1's

I hypothesised that a revoke tapped while `authUid` is null (offline boot) silently no-ops. I did **not**
reproduce this independently and I now believe the pure-offline variant is mostly unreachable: Firebase Auth
restores its anonymous session from IndexedDB without the network, so `authUid` usually populates offline,
and RTDB queues writes offline and replays them on reconnect. The genuinely reachable trigger for
"`sharingReady()` is false at revoke time" is `cloudSyncEnabled === false` — which is exactly F1. Keeping
this entry only so the reasoning isn't re-derived later.

The underlying observation still holds and motivates the F1/F2/F6 fix: `allowed/` is treated as an **event
stream** (apply a delta on tap, swallow failures) rather than as **desired state to converge on**. Every
other cloud tree in this app has a reconciler; `allowed/` has none.

`revokeShare()` (index.html:2220) is the *only* thing that ever removes a grant:

```js
function revokeShare(theirPid) {
  if (!myProfileId || !sharingReady()) return;      // <-- silent no-op
  fb.ref("statsProfiles/" + myProfileId + "/allowed/" + theirPid).remove().catch(function () {});
}                                                    // <-- swallowed failure
```

Two independent ways the grant survives while the UI shows it revoked:
1. `sharingReady()` is false at the moment of the tap (`cloudSyncEnabled && authUid && fb`). `authUid` is
   null until anonymous auth resolves — i.e. **offline, or during the first seconds of any boot**. The tap
   still writes `peer.share = false` locally and persists it.
2. The `.remove()` rejects (transient/offline) and the `.catch` swallows it.

Nothing reconciles afterwards. `bootStatsSharing()` (2397) re-grants and re-subscribes but **never
revokes**; `setStatsSharing(true)` (2368) likewise only calls `grantShare` for `share !== false` peers.
So `allowed/` is a monotonically-growing set that only shrinks if a live write happens to land.

**Root cause (provisional):** the grant map is treated as an event stream (apply the delta on tap) rather
than as desired state to converge on. Every other cloud tree in this app has a reconciler; `allowed/` has none.

### F2 — Turning Stats Sharing off on a linked device revokes nothing — **CONFIRMED**
**Severity:** High (privacy)
**Repro:** `scratchpad/f2-linked-device-cannot-revoke.js`

Alice has a phone (A1) and a tablet (A2), linked, sharing **one** statsProfile. A1 plays Bob and grants him.
Alice then turns Stats Sharing **off on the tablet**:

```
PASS  A2 adopted the SAME profileId (one person, one profile)      [spU2QA7ARJSMBH vs spU2QA7ARJSMBH]
PASS  A1 granted Bob on the shared profile                         [{"spXSZAH3M6FL85":true}]
PASS  A2 (tablet) never learned Bob exists (peer roster is blind)  [A2 peers = []]
PASS  A2's People list shows no one to cut off                     [peer rows = 0]
PASS  A2 (tablet): master sharing toggled OFF
PASS  REALITY: Bob's grant survives the tablet's master-off        [{"spXSZAH3M6FL85":true}]
FAIL  *** BUG: Bob still reads Alice's digest after she turned sharing off on her tablet ***
```

Worse than predicted: the tablet's People list renders **zero rows**, so there is no per-person control to
fall back on either. The master toggle is the only control there, and it is a no-op.

**Root cause.** `setStatsSharing(false)` (2368) iterates `Object.keys(sharePeers)` — a **per-device** roster
restored only from the device's own uid:

```js
function restorePeersFromCloud(then) {                        // index.html:2272
  fb.ref("users/" + authUid + "/sharePeers").once("value")    // <-- OWN uid only
```

History fans out across `linkedUids` (`subscribeLinkedHistories`, 1367); the peer roster never does. So
`sharePeers` is per-device while `allowed/` is per-person — and the revoke loop is driven by the per-device
copy. Any grant created on another device is unreachable. The design note in memory says peers are
"merged across linked devices like history"; the implementation does not do this.

### F3 — A grantee can read the owner's `allowed/` map and profile root — **CONFIRMED**
**Severity:** Medium (contradicts a *user-facing* promise, not just a code comment)
**Repro:** `scratchpad/f3-probes.js`

```
FAIL  F3:  Bob CANNOT read Alice's allowed/ map    [READABLE: {"sp6QWWCXW7Y2LT":true}]
FAIL  F3b: Bob CANNOT read Alice's profile root    [READABLE ownerUid=ZtmdiSGlMXaLLLHMOmayLbOED4Au]
```

The read rule is set at the `$profileId` level and **cascades to every child**, including `allowed/` and
`ownerUid`. index.html:2133 claims followers "subscribe to the /digest child ONLY so the allowed/ map ...
never leaks" — a *client-side convention*, not an enforced boundary.

Why this is more than a comment violation — the sharing sheet promises the user, in as many words (4413):

> "people you play shared games with can see your overall record and a few highlight games
> (**who else you played with stays private unless you say so below**)"

`allowed/` holds opaque profileIds, so it is not a name dump on its own. But `tournamentClaims/<code>` is
readable by any signed-in code-holder and maps **profileId → name**. So any follower who has shared a
session with Carol knows Carol's pid, and can then read Alice's `allowed/` to determine whether Alice
shares with Carol. That is exactly the promised-private fact.

F3b additionally leaks the owner's Firebase `ownerUid`. Not directly exploitable (every uid-keyed path —
`users/$uid`, `personOf/$uid`, `profileOf/$uid` — requires `auth.uid === $uid` or a `personOf` match), but
it is a stable cross-profile correlator that followers should not receive.

### F5 — A frozen digest is still presented to followers as "shared live" — **CONFIRMED**
**Severity:** Medium (trust/correctness — stale data labelled current)
**Repro:** `scratchpad/f3-probes.js`

```
FAIL  F5: Bob's UI still titles the frozen digest 'Overall record — shared live'  [labelled live; frozen at games=1]
```

Once Alice unlinks (F1), her digest stops updating but stays readable. Bob's Stats page keeps rendering it
under the section title **"Overall record — shared live"**, with copy (6380) promising:

> "shared live from their own device — every game they record anywhere ... kept current as they play"

Bob gets no signal that the record froze; it drifts from reality indefinitely. The digest already carries
`updatedAt`, so the data needed to detect staleness is present and simply unused.

### CONTROL — the intended revocation path works correctly — **VERIFIED GOOD**

Load-bearing for fix design. With backup **on**, the master toggle revokes exactly as designed:

```
PASS  CONTROL setup: Alice could read Bob's digest                           [readable]
PASS  CONTROL: Bob's grants ARE revoked when master-off runs with backup on  [null]
```

So the revocation machinery is sound. F1 and F2 are **not** "revocation is broken" — they are
**"revocation is bypassed"**: F1 because `unlinkDevice()` never calls it, F2 because it is driven from a
roster that cannot see the grants. The fix is about *reaching* the existing machinery, not rebuilding it.

### F4 — `genRecordId()` collides; a collision silently destroys games — **CONFIRMED**
**Severity:** High (**data loss**, both in the cloud backup and locally)
**Repro:** `scratchpad/f4-id-collision.js`

C5 in the old notes said "casual ids are `Date.now()` with no random part". That is **stale** — all four
archive sites now use `genRecordId()`. But the fix that closed C5 does not do what it looks like it does:

```js
function genRecordId() { return Date.now() + Math.floor(Math.random() * 1000); }   // index.html:1790
```

This **adds** jitter to a timestamp rather than composing timestamp + entropy in separate namespaces. The
random term doesn't widen the id space — it smears each record's id across a ~1-second window, so any two
records archived within ~1s of each other can land on the same integer. Measured with the real function
extracted from `index.html` at runtime (200k trials per row, same-millisecond burst):

| records archived together | P(at least one collision) |
|---|---|
| 2  | 0.11% |
| 3  | 0.29% |
| 4  | 0.59% |
| 8  | **2.80%** |
| 12 | 6.43% |
| 16 | 11.32% |

Bursts are not hypothetical: `syncMyHistoryFromTourney()` (1834) archives **every** newly-completed match
in one synchronous loop — a device that was backgrounded/offline while a tournament progressed archives N
matches with an identical `Date.now()`. (The real window is ~1s wide, not 1ms, so these rates are the
conservative floor.)

Two independent consequences, both reproduced through the app's real code paths:

```
FAIL  *** BUG: cloud backup holds all 3 games (id collision overwrites one) ***
        [cloud has 2/3: keys=1784000000500,1784000012845]
FAIL      -> which game survived in the cloud
        [only "Eagles" (the "Hawks" game is gone from the backup)]
FAIL  *** BUG: deleting one collided game leaves the other (deletes both) ***
        [remaining after deleting one: [Control] (expected 2 games left)]
```

1. **Cloud backup silently drops a game.** `syncHistoryToCloud()` (1061) writes to
   `users/<uid>/history/<r.id>` — the id *is* the storage key, so the second record overwrites the first.
   Local still shows both, so nothing looks wrong until a restore, at which point the game is simply gone.
2. **Deleting one game deletes both.** `deleteHistoryRecordWithUndo()` (6875) filters
   `g.id !== rec.id`, which matches both records. Undo re-inserts only one. Net: user deletes one game,
   loses two, permanently.

A third, latent consequence — the original F4 hypothesis — remains real but is subsumed:
`mergedHistoryForStats()` (5983) keys tombstones and dedup differently:

```js
var tombstoneKey = r.matchUid || r.id;                       // NOT owner-scoped
var key         = r.matchUid || (item.owner + ":" + r.id);   // owner-scoped
```

The dedup key is owner-scoped precisely because ids collide across devices; the tombstone key on the line
above is not. So deleting a local record on one device also hides a *linked* device's record sharing that
id. Same root cause (id space too narrow), so it is folded into F4.

**Root cause.** The id is required to be **globally unique across devices** (it is the cloud storage key
and half the cross-device dedup key), but it is generated as a *local wall-clock reading with jitter*. Two
independent requirements — "sortable by time" and "unique" — were collapsed into one integer, and the
arithmetic makes the entropy cancel rather than compose.

---

---

# Interaction analysis — how these relate, and where a fix creates a bug

## Two root causes, not six bugs

```
ROOT CAUSE A — "allowed/ is an event stream, not reconciled desired state"
  ├── F1  unlinkDevice() never calls the revoke path at all
  ├── F2  setStatsSharing(false) drives revoke from a per-device roster
  │        that structurally cannot see other devices' grants
  └── F6  after owner unlink, the rules forbid the revoke write entirely
           (so no client-side reconciler can ever succeed)

ROOT CAUSE B — "one integer is doing two jobs (time-ordering AND identity)"
  └── F4  genRecordId() = Date.now() + jitter → collisions → cloud overwrite + double-delete

INDEPENDENT
  ├── F3  read rule cascades from $profileId to allowed/ + ownerUid (rules shape)
  └── F5  digest staleness is never surfaced (updatedAt present but unused)
```

The CONTROL result is the key structural fact: **revocation itself works.** F1/F2/F6 are three different ways
of *not reaching* working machinery. That means one reconciler + one rules change resolves all three — but
only in that order, and only if the rules change lands first (see below).

## Severity re-ranking after interaction

F6 outranks F1 despite F1 being easier to hit, because F6 is **unrecoverable**: F1's damage is undone the
moment the user turns backup back on and revokes, whereas F6's orphaned grants can never be revoked by
anyone. F1 is the *common* path into F6: a user who turns off backup (F1) on the device that happened to
mint the profile has silently created a permanently-unrevocable grant.

**F1 and F6 are the same user action** — "turn off Cloud Backup" — with different consequences depending on
whether that device minted the profile. The user cannot tell which device that is; nothing surfaces it.

## Where fixing one bug creates another

### ⚠️ Fixing F1 the obvious way introduces a regression
Making `unlinkDevice()` call `setStatsSharing(false)` looks right and is **wrong**. Unlink has two distinct
meanings that the current UI conflates:
- *"I'm leaving the sharing system"* → revoking every grant is correct.
- *"I'm removing this spare/old device from my group"* → revoking is **destructive**: grants are
  **per-person**, so unlinking a tablet would silently stop the still-active phone from sharing with
  everyone. Users would see sharing die for no visible reason.

Any F1 fix must first answer "is this the person leaving, or a device leaving?" — that's a product decision,
not a code one. Cheapest correct version: on the unlink confirm sheet, state what will happen to sharing and
let the user choose. **Do not silently pick one.**

### ⚠️ Fixing F2 alone silently fails whenever F6 applies
Merging peers across linked devices (fanning `sharePeers` out over `linkedUids`, the way
`subscribeLinkedHistories` already fans out history) makes `setStatsSharing(false)` see every grant. But if
the profile is already orphaned (F6), each resulting revoke write is `PERMISSION_DENIED` and
`revokeShare()`'s `.catch(function(){})` **swallows it silently**. The UI would then report a *complete*
revocation that fully failed — strictly worse than today, where at least the roster is visibly empty.
**→ F6's rules fix must land before, or with, F2's client fix. Never F2 alone.**

### ⚠️ F3 and F6 share one fix — do them together
Both are consequences of `allowed/` living **inside** the profile node:
- read cascades from `$profileId` → the grant map leaks (F3);
- write is authorized by the *profile owner's* `personOf` chain → orphaning (F6).

Moving grants to their own top-level node keyed by the grantee's own identity fixes both at once:
```
statsGrants/<ownerProfileId>/<granteeProfileId>
  .write: root.child('profileOf').child(auth.uid).val() === $ownerProfileId   // any device OF that person
  .read:  false (or owner-only)                                               // closes F3
```
This authorizes on `profileOf[auth.uid] === $ownerProfileId` — a fact about the *writing* device — instead
of a chain through the owner's `personOf`, which unlink destroys. Fixing them separately means touching the
same rules block twice and re-testing the whole surface twice.

### ⚠️ Fixing F5 alone would *mask* F1 and F6
Surfacing "last updated 3 weeks ago" makes a frozen digest look *intentional*, which is exactly what a
victim of F1/F6 would see. F5 is worth fixing, but it must not be mistaken for addressing the leak, and it
should not ship first — it would reduce the visible symptom of two unfixed high-severity bugs.

### ⚠️ F4's fix must not migrate existing ids
Widening the id space is safe (Firebase keys are strings already; `mergedHistoryForStats`'s
`owner + ":" + id` and the `history/<id>` path both tolerate a string id). But **do not rewrite ids on
existing records**:
- `historyTombstones` is keyed by `matchUid || id` — re-keying resurrects every locally-deleted casual game;
- already-synced cloud copies are keyed by the old id — a migration would duplicate rather than move them.
Generate new ids in the new format; leave old records alone. The two formats coexist safely because
uniqueness is only ever compared record-to-record.

F4 is otherwise **independent** of A-cluster: different subsystem, no shared state. It can ship in parallel.

## Recommended fix order

1. **F6 rules change** (grants out of the profile node, authorized via `profileOf`) — unblocks everything
   in cluster A and closes F3 in the same edit. Must be published to Firebase *before* the client fix.
2. **Audit production for already-orphaned profiles** — F6's existing damage is invisible to the client and
   is not repaired by the fix. Needs an admin-side sweep.
3. **F2 client fix** (fan `sharePeers` out across `linkedUids`; make `revokeShare` surface failures instead
   of swallowing them).
4. **F1 product decision + fix** (unlink must state its effect on sharing; stop deriving the On/Off label
   from `statsSharingOn()` — show the *setting*, and show connectivity separately).
5. **F4** (independent — can land any time).
6. **F5** (last, once the states it would label are genuinely trustworthy).

---

# Work completed (2026-07-17)

## 1. Regression guards — `stress-test/scenarios/stats-sharing.js`

Six guards, one per finding, in a new **`sharing` phase** that runs against **local emulators** rather than
production. It has to: the assertions need the emulator's `?access_token=owner` backdoor for ground truth
(the whole point is that the app *can't* read those paths), the scenarios deliberately drive revocation
failures that against production would leave real unrevocable grants on real profiles, and they reset the
database between scenarios. The orchestrator **skips the phase with a loud notice** when the emulators
aren't up, so ordinary runs are unaffected — silent skipping of privacy guards is how these bugs survived
in the first place.

Supporting changes: `lib/emulator.js` (rules-enforced `readAs`/`writeAs` vs ground-truth `dbGet`, plus
rewiring that **throws rather than falling back to production** if `index.html` stops matching);
`lib/pageobjects/sharing.js`; `linking.enableBackupViaToggle`; `createDevice({contextInit, throttleAuth})`;
and `launchBrowser` now passes `--disable-features=LocalNetworkAccessChecks` (headless Chrome otherwise
denies page→loopback fetches, so anonymous auth against the auth emulator never resolves — this silently
broke every fixture until it was found).

Every guard asserts the **desired** behaviour, so each fails against the shipped code by design. Verified
each fails **for the right reason** — one early version reported F4's cloud-loss finding while actually
reading `users/null/history` (`storage.readKey` returns `{ok:false, value:null}` for a bare-string uid;
the rest of the suite correctly uses `.raw`). A guard that fails for the wrong reason is worse than none.

## 2. F6 fix — **rules cause fixed and verified; user-visible symptom still blocked by F2**

**Rules** (`FIREBASE_SETUP.md`, **not yet published to Firebase**): `statsProfiles/$profileId` now
authorizes a non-owner via the profile's **own `personId`** —
`root.child('personOf').child(auth.uid).val() === data.child('personId').val()` — instead of chaining
through `personOf[ownerUid]`, which `unlinkDevice()` deletes. Authorization is now a fact about the
*writer's* live group membership, which unlink cannot erase. The legacy owner-chain clause is retained as
a fallback so existing un-stamped profiles keep working. The same edit closes **F3**: the follower's read
grant moved from `$profileId` down to the **`digest` child**, so `allowed/` and `ownerUid` no longer
cascade to followers. `profileOf/$uid`'s `.validate` gained the matching `personId` door, so a device
joining after the minter left can still adopt the person's profile instead of splitting their followers.

**Client** (`index.html`): `stampProfilePersonId()` writes `statsProfiles/<pid>/personId` on every path
that can establish one — including the early-out in `ensureStatsProfile()`, which is what a device that
minted its profile while solo and linked later takes. Deduped against the last written value (harvest calls
`ensureStatsProfile` per peer) and cleared on failure so a dropped write retries.

**Verified:**
```
F3 guard:  0 findings   (was 2 — allowed/ + ownerUid no longer readable by a follower)
F6 guard:  tablet's revoke write -> ok      (was PERMISSION_DENIED)
DB:        statsProfiles/<alicePid>.personId = "p7UUZSW", owner's personOf gone, tablet's personOf matches
local phase: 22 scenarios, 0 findings       (app not broken by the client change)
```

**F6's guard is still red, and correctly so** — this is the interaction analysis above playing out exactly
as predicted, in the other direction. The rules now *permit* the tablet to revoke, but the client never
issues the revoke, because `setStatsSharing(false)` iterates a peer roster that is blind to sibling
devices' grants (**F2**). The guard was restructured to distinguish the two causes so this stays legible:
`!probe.ok` ⇒ rules regression; `probe.ok && stillReadable` ⇒ F2. **F6's fix is inert until F2 is fixed.**

**F6 remains partially unrecoverable regardless:** profiles orphaned before this change have no `personId`
stamped and their owner's `personOf` is already gone, so nothing repairs them from the client. They still
need an admin sweep.

## 3. F2 fix — **done; F2 and F6 guards both green**

Two halves, matching the two findings:
- **Revocation completeness.** `setStatsSharing(false)` now calls `revokeAllGrants()`, which enumerates the
  **authoritative `allowed/` map** and removes every entry, instead of looping `sharePeers` — a per-device
  roster that structurally cannot see a sibling device's grants. This is the reconciler the root-cause
  analysis called for: converge on desired state rather than replay a delta.
- **The blind People list.** `restorePeersFromCloud()` now fans out across `linkedUids`, the same union
  `subscribeLinkedHistories()` builds for history — peers belong to the *person*, not the device that met
  them. `setStatsSharing(true)` restores before granting, so a newly-linked device learns the person's peers
  instead of granting nobody.

Also: `revokeShare` no longer swallows failures, and a `PENDING_REVOKE_KEY` flag retries an unfinished
revoke-all at next boot (previously a dropped revoke was lost forever while the UI claimed sharing was off).

```
linked-device-can-revoke (F2):      2 findings -> 0
revocable-after-owner-unlink (F6):  1 finding  -> 0
grant-map-not-readable (F3):        2 findings -> 0
local phase:                        22 scenarios, 0 findings
remaining: F1 (2), F4 (3), F5 (1) — untouched by instruction
```

## 4. Production audit — **no damage; the fix beat real usage**

Rules published by the user 2026-07-17; `stress-test/audit-orphaned-profiles.js` run against
`somerset-scorepad` (read-only, logic unit-tested against 6 fixtures first, incl. the solo-sharer
false-positive trap):

```
3 profile(s), 182 personOf, 2 profileOf
HEALTHY: 0    RECOVERED: 0    *** STRANDED ***: 0
```

**Read this correctly: zero stranded, because Stats Sharing has never actually been used in production.**
All 3 profiles were skipped for having **no grants at all** — `allowed/` is null on every one, and only one
carries a digest (`name: "Keith"`, from the 2026-07-15 prod verification). `tournamentClaims` is empty, so
no session has ever introduced two sharing devices to each other.

So F6 caused **no production damage** and the fix landed before any real user could hit it — which is
exactly the pre-launch window this whole exercise was for. It is *not* evidence that F6 was harmless.

### Side finding: production is full of stress-test residue
```
tournaments: 779   users: 171   people: 107   personOf: 182   linkCodes: 59
statsProfiles: 3   profileOf: 2   tournamentClaims: 0
```
Almost all of this is the stress suite running against production. The `tournaments`/`linkCodes` rules
expire records (48h / 30min) but **never delete them** — expired rows persist forever, unreadable and
unwritable, consuming free-tier storage. This is the quota-burn tradeoff in `[[firebase-sync-open-issues]]`
#3, arriving via our own test suite rather than an attacker, and it is a second argument for the sharing
phase being emulator-backed.

**Do not bulk-delete `users/`** — it contains at least one real device's genuine cloud backup (the "Keith"
profile's history) mixed in with test uids, and there's no reliable server-side discriminator. Any cleanup
needs a dated allowlist or a fresh project for testing. Not attempted.

## 5. F1 fix — **done; both branches guarded**

Product decision (user, 2026-07-17): **revoke iff this is the person's last backing-up device.** Not a
guess — it follows from the system. Sharing is per-PERSON, so:
- **Siblings remain** → this device just leaves; the others keep publishing and the person keeps control
  there. Revoking would silently cut off everyone the user's *other* phone still shares with.
- **Last device** → nobody would be left to publish, so the digest would freeze while staying readable
  forever, with the control to stop it gone. Revoke.

Implemented in `unlinkDevice()` via `isLastBackupDevice()`, plus:
- **The label now states the setting, not connectivity**: `(autoShare && cloudSyncEnabled)` instead of
  `statsSharingOn()`, which folded in `authUid` and made the row flicker "Off" on every boot.
- **The confirm sheet names the consequence** before the tap, and says something different in each case
  ("Your other devices keep backing up, and keep sharing your stats." vs "You're also sharing your stats
  with N people. Turning off backup stops sharing with all of them.").
- **Ordering is load-bearing**: the revoke runs *before* teardown, because `unlinkDevice()` removes this
  device's `personOf` — which is its own authorization to write the profile. After that a retry could never
  succeed. If the revoke is still owed, `personOf` is deliberately **held back** so
  `retryPendingRevokeAll()` can finish at next boot, and dropped in the revoke's callback instead.
  `retryPendingRevokeAll()` also had to move outside the `cloudSyncEnabled` gate in the boot path — the
  case it exists for is precisely one where that flag is already false forever. Revoking now checks
  `cloudWritable()` (auth + fb) rather than `sharingReady()` (which demands backup be **on** — useless at
  the one moment revoking matters most).

Both branches are guarded — `unlink-spare-keeps-sharing` is a new scenario covering the non-revoke path,
which the solo-device guard never reaches and which is the exact regression "always revoke" would have shipped.

```
backup-off-stops-sharing (F1):      2 findings -> 0
unlink-spare-keeps-sharing (F1b):   0 (new; fails against an always-revoke implementation)
linked-device-can-revoke (F2):      0
grant-map-not-readable (F3):        0
revocable-after-owner-unlink (F6):  0
local phase:                        22 scenarios, 0 findings
remaining: F4 (3), F5 (1)
```

## 6. F4 fix — **done; guard green**

```js
// before
function genRecordId() { return Date.now() + Math.floor(Math.random() * 1000); }
// after
function genRecordId() { return Date.now() + "-" + genCode(); }   // e.g. 1784295665372-H25WUK
```

Time and identity now live in **separate parts of the string** so the two terms compose instead of
cancelling: a millisecond prefix for ordering, plus 30 bits of crypto RNG from `genCode()` — the same
generator the join codes and profile ids already use. Measured with the real function extracted from
`index.html`: **2.8% → 0 collisions in 200,000 eight-record bursts.**

Second half, and the part that protects data **already on people's phones**:

```js
// before — matches BOTH records when two ids collide; Undo restores only one
gameHistory = gameHistory.filter(function (g) { return g.id !== rec.id; });
// after — identity; removes exactly the game the user tapped
gameHistory = gameHistory.filter(function (g) { return g !== rec; });
```

`rec` is always the very object being rendered out of `gameHistory`, so identity is exact. This matters
beyond F4: records archived by older builds can *already* carry colliding ids, and the fixed generator does
nothing for them. It also stops a linked device's record from deleting a local game that shares its id.

**Deliberately not asserted, and not fixed: the cloud overwrite.** The id *is* the storage key under
`users/<uid>/history/<id>`, so colliding records overwrite each other there by construction. That is now
unreachable for anything the fixed generator produces, and unrepairable for legacy records it already hit —
re-keying history would resurrect every tombstoned game (tombstones are keyed `matchUid || id`) and
duplicate every synced copy. The guard's comment records this so the omission stays a decision rather than
an oversight.

No migration of existing ids, per the interaction analysis. The formats coexist safely because ids are only
ever compared record-to-record — every call site uses strict `===`/`!==` against a stored copy of the
record's own id; nothing parses, orders, or does arithmetic on one. Verified by grep before changing the type.

```
record-ids-survive-archive-burst (F4): 3 findings -> 0
local phase (incl. history export/import round-trip + dedup): 22 scenarios, 0 findings
remaining: F5 (1)
```

## What I did not fix
F5 — reproduced and root-caused only. It is the last open finding, and safe to do now that every state it
would label is trustworthy.

---

## Open issues carried in from prior sessions (to re-test, not assume)

- **C4** — no deletion tombstones cloud-side: a shared match deleted on one device resurrects via the linked copy.
- **C5** — casual record ids are `Date.now()` with no random part, but are now cross-device dedup keys.
- **#11** — redeem-time owner confirmation (partially addressed: `ownerName` now rides in the linkCode).
- **#10** — client-side consume-on-redeem (appears implemented at 1304 — verify).

## Known v1 limitations (documented; verify blast radius rather than re-finding)

- Original-ownerUid device unlinking locks remaining devices out of digest writes.
- Two linked devices flipping sharing on simultaneously race two profiles.
- Wrong-NAME claims by session code-holders.

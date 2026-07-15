# Security Review — SomeRSet Scorepad

**Date:** 2026-06-22
**Scope:** `index.html` (single-page app), Firebase Realtime DB rules (`FIREBASE_SETUP.md`), repo config (`.env.local`, `.gitignore`, `.vercelignore`).
**Reviewer:** Claude (time-boxed review)

---

## Summary

The app is a static, client-only scorekeeper with an optional Firebase Realtime Database sync layer keyed on a 6-character share code. No server-side code, no auth. Overall the client-side XSS surface is **well contained** — the one dangerous sink is never reached. The meaningful risks are all in the **open, no-auth Firebase backend** and its security rules, plus one config-hygiene issue around deploy ignore rules.

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | **Medium** | `_createdAt` is unvalidated in the rules → 48h expiry trivially bypassed; records can be made permanent | **Fixed** (`46cf8f9`, 2026-06-22) |
| 2 | **Medium** | Open, no-auth backend: anyone can read/write/overwrite any code → quota abuse, data tampering, lost updates | Accepted tradeoff (casual app) |
| 3 | **Low** | Share codes generated with `Math.random()` (non-cryptographic); codes are the *only* access control | **Fixed** (`46cf8f9`, 2026-06-22) |
| 4 | **Low** | `.vercelignore` only excludes `*.md` — does not exclude `.env*`/`.vercel`, risking deploy-time exposure | **Fixed** (`46cf8f9`, 2026-06-22) |
| 5 | **Info** | No data-size/shape validation in rules → oversized-payload quota abuse | Open |
| 6 | **Info** | XSS sinks reviewed and found safe (documented for assurance) | N/A |

---

## Findings

### 1. Medium — Security rules don't validate `_createdAt`; expiry & access window are bypassable (Fixed)

The read/write rules gate everything on `(now - data.child('_createdAt').val()) < 172800000` (48h). Legitimate clients set `_createdAt` via `firebase.database.ServerValue.TIMESTAMP` (index.html:472, :872), but the **rules never constrain what `_createdAt` may be**. A client talking to the REST/SDK API directly can write any value:

- Set `_createdAt` to a **future** timestamp → `now - _createdAt` is negative, always `< 172800000` → the record **never expires** and stays readable/writable indefinitely, defeating the central "auto-cleans after 48h" guarantee that the whole design leans on.
- This converts the transient quota cost of finding #2 into a **permanent** one.

**Fix:** add a `.validate` on `_createdAt` for new records, e.g. require `newData.child('_createdAt').val() <= now && newData.child('_createdAt').val() >= now - 60000` (server-time on create), and forbid changing it on update (`!data.exists() || newData.child('_createdAt').val() === data.child('_createdAt').val()`).

**Resolved:** `FIREBASE_SETUP.md`'s `tournaments/$code` rule now validates exactly this — `_createdAt` must be `<= now`, and on create must be within the last 60s; on update it must either stay unchanged or be re-stamped to now (rematch/redraw), never pushed further into the future. See `FIREBASE_SETUP.md`'s note at that rule for the full reasoning.

### 2. Medium — Open, no-auth backend (read/write/overwrite any code)

Confirmed and consistent with the prior review note. The rules allow **any** anonymous caller to create, read, and overwrite **any** tournament code inside the 48h window. Consequences:

- **Data tampering:** anyone who learns/guesses a code can overwrite live scores. There is no writer identity or per-match authorization at the rules level (the in-app "lock" lives inside the same clobbered object, so it is advisory only).
- **Lost updates:** `saveTourney` (index.html:473) and `startSharedTournament` (index.html:875) persist the whole record with `.set()`. Concurrent writers → last-write-wins, silent loss.
- **Code collision overwrite:** `startSharedTournament` calls `genCode()` then `.set()` **without checking existence** (index.html:870–875). A ~1-in-10⁹ collision (or a deliberate one) silently destroys an existing tournament.
- **Quota abuse:** unauthenticated mass-create burns free-tier quota.

**Fix (design):** introduce light auth (Firebase Anonymous Auth) and scope writes to participants; use `transaction()` / granular `update()` for per-match writes; on create, use a `transaction` or `update` with a `!data.exists()` guard to avoid clobbering.

### 3. Low — Share codes use `Math.random()`, the sole access control (Fixed)

`genCode()` builds the 6-char code from `Math.random()` (index.html:598–600); device IDs and team IDs likewise (index.html:541, :1784, :2407). `Math.random()` is **not cryptographically secure** and its internal state is observable/predictable in-engine. Because the code is the *only* thing protecting a tournament (finding #2), weak generation lowers the bar for an attacker who can observe sample outputs to narrow guesses.

**Fix:** generate codes with `crypto.getRandomValues()`.

**Resolved:** `genCode()` now uses `window.crypto.getRandomValues()` (masking each byte to 5 bits against the 32-entry `CODE_CHARS` alphabet, unbiased since 256 % 32 === 0), falling back to `Math.random()` only on browsers without `crypto.getRandomValues`.

### 4. Low — `.vercelignore` doesn't exclude `.env*` / `.vercel` (Fixed)

`.vercelignore` contains only `*.md`. `.gitignore` correctly excludes `.env*`, `.vercel`, and `.DS_Store`, but **`.vercelignore` is independent of `.gitignore`**. `.env.local` currently holds a `VERCEL_OIDC_TOKEN` (short-lived, but a live credential). For a static deployment this risks uploading dotfiles/credentials into the deployment bundle.

**Fix:** add `.env*`, `.vercel`, and `.DS_Store` to `.vercelignore`. (The committed Firebase `apiKey` in index.html is **not** a secret — that is normal and safe for Firebase web apps.)

**Resolved:** `.vercelignore` now lists `*.md`, `.env*`, `.vercel`, and `.DS_Store`.

### 5. Info — No size/shape validation → oversized payloads

The `.validate` rule only checks that `format` and `teams` exist and that `format` is one of four strings. There is no bound on payload size or depth, so a writer can store large blobs to accelerate quota exhaustion (compounds #1/#2).

### 6. Info — Client-side XSS surface reviewed: safe

- The hyperscript helper `el()` assigns `innerHTML` **only** for a prop literally named `html` (index.html:1003), and **no call site ever passes a `html:` prop** — the dangerous sink is dead code.
- All dynamic/synced content (team & player names) renders through `document.createTextNode(...)` (index.html:1011) and `textContent` (e.g. :2427, :2431, :2773), which are injection-safe.
- All other `innerHTML` uses are static teardown (`= ""`).
- No `eval`, `new Function`, `document.write`, `insertAdjacentHTML`.
- No URL/`location`/`hash` sinks — share codes are typed in, not read from the URL, so there is no DOM-based reflected XSS.

**Note:** the safety of #6 depends on team/player names never being routed through a `html:` prop or `setAttribute("style"/"on*", ...)`. Keep that invariant if the renderer changes.

---

## Recommended priority

1. ~~Add `.env*` / `.vercel` to `.vercelignore`.~~ — #4, **fixed**
2. ~~Validate `_createdAt` (and freeze it on update) in the rules.~~ — #1, **fixed**
3. ~~Switch `genCode()` to `crypto.getRandomValues()`.~~ — #3, **fixed**
4. Plan the auth + granular-write refactor for tamper/lost-update resistance. — #2/#5

Items #1, #3, #4 were quick wins, all landed the same day as this review in `46cf8f9`. #2's full fix remains a deliberate design decision (documented as an accepted tradeoff for a casual app); #5 (payload size/shape validation) is still open and would be worth folding into whatever rules work eventually addresses #2.

---

## Addendum — Device Linking / Cloud History Backup (2026-07-13)

**Scope:** the new opt-in "Back up my History" feature — Firebase Anonymous Auth, `users/$uid` history sync, and the `linkCodes`/`people`/`personOf` device-linking rules added to `FIREBASE_SETUP.md` §4/§4a. Finding #2's accepted no-auth tradeoff above is unaffected — `tournaments/$code` is untouched by this feature.

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 7 | Low | `personOf/$uid` write wasn't validated against real group membership — a device could self-declare linkage to any `personId` it could guess or learn | **Fixed** same day |
| 8 | Low | `people/$personId/linkedUids/$uid` write still isn't gated by proof of a valid, unexpired `linkCodes` entry — a device can join any group it can name, bypassing the intended one-time-code flow | **Fixed** — proof-of-code `.validate` **published** to live rules 2026-07-14; client forward-compatible (redeem stores the code as the membership value); legit paths reverified by the 4 device-linking scenarios |
| 9 | Low | `personOf/$uid` is world-readable to any signed-in client — a uid→personId oracle that undercuts #8's "personId is never exposed" defense | **Fixed** — `.read` tightened to own-uid, **published** 2026-07-14 |
| 10 | Low | Link codes are multi-use and unrevocable for their whole 30-minute window; redemption never consumes them, and dead codes accumulate forever | **Fixed 2026-07-14** — `commitLinkCode` deletes the code the instant it's redeemed; `closeLinkDeviceSheet` deletes an outstanding never-redeemed code when the generator's "show code" step closes (Done, overlay tap, or back button). Covered by the new `link-code-single-use` scenario (redeem once, then a third device's redemption of the same code correctly gets "No link code found.") |
| 11 | Low | Redeeming a maliciously supplied code silently and (in-app) irreversibly links your History to a stranger — no confirmation, no unlink flow | **Fixed 2026-07-14, both parts.** (a) Unlink: `unlinkDevice()` + Display sheet "Turn off backup & unlink" → confirm; leaves the group server-side, clears local link state, keeps own History; covered by `unlink-stops-merging`. (b) Redeem-time confirmation: `lookupLinkCode`/`commitLinkCode` split the redeem flow so the sheet shows "Join `<ownerName>`'s group?" (the generator's device name, carried on the `linkCodes` record) before committing anything |
| 12 | Info | No `.validate` on values under `users/$uid` or `people/$personId/linkedUids/$uid` — unbounded blobs, fanned out to every linked peer's open listener | **Fixed** — `linkedUids` value validated by #8's rule; history records require `id`+`date`, **published** 2026-07-14 |

### 7. Low — `personOf/$uid` accepted an unvalidated `personId` (Fixed)

The rule as first published only checked `auth != null && auth.uid === $uid` on write, with no check on the *value*. Since the `users/$uid` cross-read rule (finding-free — see below) grants read access whenever two uids share the same `personOf` value, a device could write `personOf/<its own uid> = "<any personId string>"` and immediately gain read access to that group's `users/$uid` history — without ever redeeming a `linkCodes` entry for it.

**Fix applied:** `.validate` now requires `root.child('people').child(newData.val()).child('linkedUids').child($uid).exists()` — the uid must already be a real member of the `people/<personId>` group it's pointing at. `generateLinkCode()`/`redeemLinkCode()` (index.html) already write `linkedUids` before `personOf` in both flows, so the legitimate path is unaffected; only the spoofing path is closed.

### 8. Low — `linkedUids` join has no proof-of-code requirement (Accepted, deferred)

Finding #7's fix closes "point `personOf` at a group you were never invited to," but not the layer beneath it: `people/$personId/linkedUids/$uid`'s write rule (`auth != null && auth.uid === $uid`) lets any signed-in device add itself directly to *any* `personId`'s `linkedUids` map, with no check that it ever held a valid, unexpired `linkCodes/$code` pointing at that `personId`. The intended UX (Display sheet → generate/redeem a short-lived 6-char code) is a convention the app's UI follows, not something the rules themselves enforce — a client speaking the REST/SDK API directly can skip the code entirely and self-join, then legitimately pass finding #7's fixed check.

**Why deferred rather than fixed:** RTDB's declarative rules have no clean way to express "a valid, unexpired, unconsumed code for this `personId` existed" as a write-time check on a *different* path (`linkedUids`) — that needs either a Cloud Function performing the join server-side with the code as a one-time-use credential, or reworking `linkCodes` into something the rules can atomically reference and invalidate on use. Both are a real design lift, not a rule tweak.

**Why low severity in practice:** exploiting this requires guessing or learning a `personId` — a random string in the same `32^6 ≈ 1 billion`-combination guessing-difficulty class as tournament join codes (finding #3), and, unlike the 6-char `linkCodes` code, `personId` is **never shown in the app's UI at all** (not copyable, not displayed) — so an attacker would need to intercept Firebase network traffic or read another device's `localStorage` directly, not just observe normal app usage. Revisit alongside finding #2/#5's broader auth refactor if this feature's threat model changes (e.g., real accounts, sensitive data beyond card-game history).

**Second opinion (2026-07-13 overnight review):** the *low severity* call is agreed — with two amendments.

1. The secrecy argument is weaker than stated, because of finding #9 below: `personOf` is readable by any signed-in client, so anyone who learns a **uid** (a much more widely handled value than `personId`) can resolve it to the `personId` and then walk straight through this gap. The two findings compound; fixing #9 restores most of #8's "never exposed" premise.
2. The deferral rationale ("needs a Cloud Function or a `linkCodes` rework") is **overstated** — RTDB rules *can* express proof-of-code with a modest tweak: store the redeemed code as the `linkedUids` value instead of `true`, and validate it against `linkCodes`:

   ```json
   "linkedUids": {
     "$uid": {
       ".write": "auth != null && auth.uid === $uid",
       ".validate": "(!root.child('people').child($personId).exists() && newData.val() === true) || (data.exists() && newData.val() === data.val()) || (root.child('linkCodes').child(newData.val()).child('personId').val() === $personId && (now - root.child('linkCodes').child(newData.val()).child('createdAt').val()) < 1800000)"
     }
   }
   ```

   - First clause: the **creator bootstrap** — when the `people/<personId>` group doesn't exist yet there is nothing to protect, so the first device may write `true` (this is exactly `generateLinkCode`'s first write, which happens before any `linkCodes` entry exists).
   - Second clause: idempotent rewrite of an existing entry (`generateLinkCode` re-runs its `linkedUids` write on an already-linked device).
   - Third clause: a **joiner must present a live, matching code as the value** — `redeemLinkCode` changes one line, `.set(true)` → `.set(code)`. All membership checks elsewhere (rules `.exists()`, client `Object.keys`) are value-agnostic, so nothing else moves.

   Remaining honest caveats: the code is still multi-use within its 30-minute window (finding #10), and group members can see each other's stored join codes (they expire in 30 minutes and members are mutually trusted, so this is cosmetic). This closes the "self-join any group you can name" hole at the rules layer for roughly one published-rules edit plus a one-line client change — worth doing before ship rather than deferring, given how cheap it turned out to be.

### 9. Low — `personOf/$uid` is world-readable: a uid → personId oracle (Fixed)

`personOf/$uid`'s `.read` is `auth != null`, i.e. **any** signed-in client can resolve **any** uid to its `personId`. Nothing needs this: the app only ever *writes* `personOf` (grep confirms no client read), and the `users/$uid` cross-read rule consults it via `root.child(...)` inside rule evaluation, which requires no client read grant at all.

**Failure scenario:** finding #8's accepted risk rests on `personId` being unguessable *and never exposed*. This read rule converts every **uid** exposure into a `personId` exposure: an attacker who learns a victim's uid from any channel (a shared device's localStorage, a network trace, a future feature that writes uids somewhere visible) reads `personOf/<uid>`, gets the `personId`, self-joins via #8, and passes #7's fixed membership check legitimately — full ongoing read access to the whole group's history.

**Fix applied:** tightened to `".read": "auth != null && auth.uid === $uid"`, published 2026-07-14. Nothing in the app broke; verified against every `personOf` reference in `index.html` and by the full device-linking stress suite.

### 10. Low — Link codes are multi-use, unrevocable, and immortal (Fixed)

`redeemLinkCode` never deleted the code it redeemed, and the original write rule (`!data.exists() || data.child('ownerUid').val() === auth.uid`) meant the **redeemer couldn't delete it even best-effort** — only the owner could. `generateLinkCode` never cleaned up its own codes either (each tap mints a new one), and RTDB has no TTL — the 30-minute window only gates *reads*, so expired codes piled up as permanent garbage rows.

**Failure scenario (now closed):** the intended one-device-shows-another UX treats the code as single-use, but anyone who saw it within 30 minutes — shoulder-surf, a photo of the screen, pasted into the wrong chat after the "tap to copy" — could redeem it too, silently joining the person-group with ongoing read access to every linked device's history (and nothing in the UI ever showed group membership, so the extra member was invisible).

**Fix applied 2026-07-14:** the rules' any-auth delete clause (`!newData.exists()`) was already published; the client now actually uses it both ways. `commitLinkCode` (index.html) deletes `linkCodes/<code>` immediately after a successful join — the code is single-use in practice, not just by convention. `closeLinkDeviceSheet` deletes an outstanding, never-redeemed code the moment the generator's "show code" step closes, via any path (Done button, overlay tap, Android back) — so an abandoned code doesn't sit around redeemable for its full 30-minute window either. Regression guard: `device-linking/link-code-single-use` (A generates, B redeems, then C's redemption of the same code correctly gets "No link code found.").

### 11. Low — Redeeming a hostile code silently links your History to a stranger (Fixed)

`redeemLinkCode` used to trust whatever `personId` the code carried, with no confirmation of *whose* group you were joining and no display of group membership anywhere in the UI afterward.

**Failure scenario (now closed):** an attacker generates a code on their own device and social-engineers the victim into typing it — "enter this code and our stats will merge for the tournament." The victim's entire game History would become readable by the attacker from that moment on (silently, indefinitely), and the attacker's records would pollute the victim's Personal Stats.

**Fix — part (a), the unlink control: shipped 2026-07-14.** `unlinkDevice()` (index.html) detaches every cloud listener, best-effort deletes this device's `people/<pid>/linkedUids/<uid>` entry and `personOf/<uid>` reverse index (both permitted by the rules: own-uid write; `personOf`'s `.validate` allows deletion via `!newData.exists()`), and clears local `personId`/`linkedUids`/`cloudSyncEnabled` plus all in-memory merge caches — leaving this device's *own* `gameHistory` and its cloud copy under `users/<uid>` untouched, so backup can be re-enabled later and restores. UI: Display sheet → "Cloud backup: On" → "Turn off backup & unlink" → a confirm step spelling out the consequences → returns to the Display sheet, whose entry has reverted to "Back up my History" (self-evident confirmation, no misleading Undo affordance since the server membership is gone and re-adding now needs proof-of-code). Regression guard: `device-linking/unlink-stops-merging` (links two devices, confirms A merges B's game, unlinks A, asserts A's link state cleared, B's game dropped from A's Stats, and A's own History intact). This closed the "victim cannot undo it in-app" half of the failure scenario — recovery is a two-tap flow, not hand-editing Firebase.

**Fix — part (b), redeem-time confirmation: shipped 2026-07-14.** `redeemLinkCode` is now split into `lookupLinkCode` (reads the code, writes nothing) and `commitLinkCode` (does the actual join). The link-device sheet inserts a "Join This Group?" confirmation step in between, showing "This will merge your game History with `<ownerName>`'s device..." — `ownerName` is the generator's persisted device name (`myDeviceName`), carried on the `linkCodes` record purely for display, never used for access control. A code from a device with no saved name shows a generic "that device didn't share a name" fallback rather than blocking the join. Prevention, not just recovery — a victim now sees *whose* group they're about to join before anything is written. Covered incidentally by every device-linking scenario that links two devices (the confirm step is now a required hop in the redeem flow).

### 12. Info — No value validation under `users/$uid` or `linkedUids/$uid` (Fixed)

`users/$uid` had no `.validate` at all, and `people/$personId/linkedUids/$uid` accepted any value (`true` was convention, not rule). A client could store arbitrarily large blobs under its own uid's history or its own `linkedUids` entry. Same family as finding #5, with one twist: linked peers hold **open `on("value")` listeners** on both paths (`subscribeLinkedHistories`), so one member's oversized write is repeatedly downloaded by every other member — a bandwidth/quota amplifier inside the trust group, not just abstract quota abuse.

**Fix applied, published 2026-07-14:** `linkedUids/$uid`'s value is now validated by finding #8's proof-of-code `.validate` (subsumes the plain `newData.val() === true` check). `users/$uid/history/$recId` requires `newData.hasChildren(['id','date'])` — deliberately not the stricter `['id','date','teams','winner']` originally proposed, since legacy imported records may lack newer fields and Firebase drops `null`-valued keys on write (see `FIREBASE_SETUP.md` §4's rule commentary); `id`+`date` are the two fields the client's restore/merge path actually depends on. RTDB still can't express a real size cap, so a determined client can still write an oversized blob under its own history entry — that residual risk is unchanged and not worth chasing further for a casual card-game app.

---

## Companion correctness findings — Device Linking / Cloud History Backup (2026-07-13 code review)

Not security: functional defects and edge cases in `index.html`'s new sync code, found in the same overnight review, formatted the same way so they can be triaged alongside #9–#12. C-numbers to avoid colliding with the security numbering.

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| C1 | **Medium** | Re-enabling backup after local data loss **wipes the cloud backup** instead of restoring it; there is no cloud→local restore path at all | **Fixed** same day — `subscribeMyHistory` now imports unknown cloud records on every snapshot (restore path); known tombstone-less caveat: an *offline* delete can resurrect once, re-deleting sticks (see C4) |
| C2 | **Medium** | The code-*generating* device never subscribes to linked histories in-session — and the stress scenario that appears to cover this passes trivially | **Fixed** same day — `enableCloudSync()` now owns all subscription wiring; `link-and-sync-history` gained a generator-side assertion (B's post-link game visible on A without reload) that fails against the old code |
| C3 | **Medium** | Boot subscribes with the cached localStorage uid without waiting for auth, and never re-subscribes when the real uid arrives | **Fixed** same day — boot block moved into `initAuth`'s callback; `authUid` is never seeded from localStorage (the key is still *written* as a stress-test oracle) |
| C4 | Low | Deleting a shared-match record doesn't stick: the linked device's copy resurrects it in merged Stats | **Fixed** 2026-07-14 — local `historyTombstones` map keyed by `matchUid \|\| id`, consulted by `mergedHistoryForStats` and by `subscribeMyHistory`'s cloud-import path (closes C1's offline-delete caveat too); covered by `deleted-shared-match-stays-deleted` |
| C5 | Low | Casual record ids (`Date.now()`, no random part) are now cross-device dedup keys — same-millisecond archives on two linked devices silently drop a game | **Fixed** 2026-07-14 — `archiveCurrentGame`/`archiveManualWin` now match `buildHistoryRecordForMatch`'s `Date.now() + Math.floor(Math.random() * 1000)` |
| C6 | Low | `subscribeLinkedHistories` stacks duplicate listeners on every membership change and never detaches removed uids | **Fixed** same day — per-uid listener registry: attach only new members, `off()` + drop cache for departed ones, full teardown on re-link to a different personId |
| C7 | Low | Closing the link sheet while a generate/redeem is in flight crashes on `ui.linkDeviceSheet.error` (null deref) | **Fixed** same day — null-guards in both error paths; late generate success no longer reopens a sheet the user closed |
| C8 | Low | Records archived just before an offline reload can strand unsynced until the *next* archive/delete | **Fixed** same day — `subscribeMyHistory`'s snapshot handler now ends with `syncHistoryToCloud()` |
| C9 | Info | `redeemLinkCode`'s `!data` branch is dead code — the read rule denies nonexistent codes, so "not found" only ever arrives as PERMISSION_DENIED | Open (harmless; keep or drop) |
| C10 | **Medium** | A freshly-linked device's history-merge listener races the peer's `personOf` write and gets **permanently cancelled** by a transient PERMISSION_DENIED — the peer's games never merge until an app reload | **Fixed** 2026-07-14 (found via the unlink work's stress diagnostic) — bounded retry-on-cancel in `subscribeLinkedHistories` |

**2026-07-13 fix batch also included** (same commit as the C-fixes): the #8 forward-compat client change — `redeemLinkCode` stores the redeemed code as the `linkedUids` value (`.set(code)`, inert under current rules), and `generateLinkCode` no longer rewrites its own membership entry when already linked (writes only `personOf` as an idempotent repair) — so publishing #8's hardened `.validate` later requires **no further client change**. The quality notes below (subscription wiring consolidation, redundant `linkedUids` concat, boot uid cache) were all addressed by the same refactor.

### C1. Medium — The prune conflates "deleted locally" with "never had locally": backup self-destructs after local data loss

`syncHistoryToCloud`'s prune removes any cloud id absent from local `gameHistory`, and `subscribeMyHistory` seeds that baseline from the server snapshot. If a device loses localStorage while keeping its Firebase auth identity (console `localStorage.clear()`, selective site-data clearing, an app-side storage bug — anything where the anonymous uid survives), then re-enables backup: the first snapshot seeds the baseline with every old record, local history is empty, and the **next `saveHistory()` deletes the entire cloud backup** — the one copy that survived. Compounding it: there is **no restore path at all** — `subscribeMyHistory` deliberately ignores record content, so a lone device can never recover its own history from its own backup; the only "restore" the feature has is Stats-merging via *other* linked devices. For a button labeled "Back up my History," that's the headline gap.

**Fix:** on the first `subscribeMyHistory` snapshot, *import* cloud records whose ids aren't present locally (they're immutable and single-writer, so this is safe and also gives the feature a real restore) instead of leaving them for the prune; alternatively (or additionally) only prune ids recorded in an explicit local tombstone list written by `deleteHistoryRecordWithUndo`, rather than inferring deletion from absence.

### C2. Medium — Generator device never merges linked histories until reload; the covering test can't see it

`generateLinkCode` → `enableCloudSync` never calls `subscribeLinkedHistories` — only `redeemLinkCode` and the boot path do. So after A generates and B redeems: B sees A's history immediately, but A doesn't see B's until the app is next reloaded (boot re-subscribes off the saved `personId`). A's local `linkedUids` also stays `[authUid]` all session.

**Test gap that hides it:** `device-linking/link-and-sync-history` only asserts B sees A's game. `device-linking/shared-match-not-double-counted` asserts the host's games-played is exactly 1 — which passes *trivially* on the broken side, because the host (generator) never merges the guest's copy at all; the dedup it exists to prove is only actually exercised on the guest. A host-side assertion on a **guest-only** game would have caught this.

**Fix:** call `subscribeLinkedHistories()` from `generateLinkCode`'s success path — or better, fold it into `enableCloudSync()` (guarded on `personId`), which also simplifies the three call sites that currently hand-wire subscriptions differently (boot / generate / redeem). Add a scenario step: guest plays a solo game post-link; assert the *host's* Stats pick it up without a reload.

### C3. Medium — Boot trusts the cached uid and never re-syncs subscriptions to the real one

The boot block subscribes immediately using `authUid` read from localStorage, without waiting for `initAuth` to resolve — and `initAuth(cb)`'s callback parameter, which exists for exactly this, is unused at boot. Two failure modes: **(a)** the cached uid is stale (Firebase's own persistence cleared while app localStorage survives, or a future auth reset): `subscribeMyHistory` attaches to `users/<oldUid>` → PERMISSION_DENIED → RTDB *cancels* the listener permanently, and when `onAuthStateChanged` later delivers the real uid nothing re-subscribes — cloud sync is silently dead until reload-after-reload happens to win. **(b)** timing: listens attached before the first auth token reach the server unauthenticated and get cancelled the same way (SDK-version dependent; the SDK does not retry cancelled listens after re-auth).

**Fix:** move the boot subscribe block into `initAuth`'s callback (`initAuth(function (uid) { if (cloudSyncEnabled && uid && initFb()) { ... } })`), and treat a uid that differs from the cached one as "re-point everything." That also makes the `AUTH_UID_KEY` localStorage cache unnecessary — one less piece of state to drift.

### C4. Low — Deletion of a shared match doesn't survive the merge (Fixed)

Deleting a shared-match record on device A removed it locally and from A's cloud path — but the linked device B archived its *own* copy of the same match (same `matchUid`, different id) under its own uid, which A's `mergedHistoryForStats` happily re-included. Net effect: the user deleted a game, watched it disappear from the Log, and it stayed in their Stats forever (and would reappear in any future merged-Log view).

**Fix applied 2026-07-14:** a local `historyTombstones` map (`somerset:dev-history-tombstones`), keyed the same way `mergedHistoryForStats` dedups (`matchUid || id`). `deleteHistoryRecordWithUndo` tombstones the key on delete and un-tombstones it if the user taps Undo. `mergedHistoryForStats` skips any tombstoned key when folding in linked devices' cached history, and `subscribeMyHistory`'s cloud-import path skips re-importing a tombstoned record on reconnect — which also closes C1's "an offline delete can resurrect once" caveat, since the existing prune logic then deletes it from the cloud copy on the very next `syncHistoryToCloud()` pass. **By design, this is local-only, not a network-wide delete broadcast:** it stops resurrection on the device that did the deleting; a linked device that never deleted its own copy keeps seeing it. That's the documented, accepted shape — "shared matches are only fully removed from the device that owns each copy" — not a remaining gap. Regression guard: `device-linking/deleted-shared-match-stays-deleted` (host deletes its copy of a shared match, host's games-played drops to 0, guest's is unaffected).

### C5. Low — `Date.now()`-only ids became cross-device dedup keys (Fixed)

`archiveCurrentGame` (`var id = Date.now()`) and `archiveManualWin` (`id: Date.now()`) had no random component — fine when ids only had to be unique within one device's array, but `mergedHistoryForStats` uses `r.matchUid || r.id` as a **cross-device** dedup key. Two linked devices archiving casual (non-shared) games in the same millisecond would collide, and one legitimate game would silently vanish from merged Stats.

**Fix applied 2026-07-14:** both archive paths now match `buildHistoryRecordForMatch`'s existing `Date.now() + Math.floor(Math.random() * 1000)`, matching the id shape used everywhere else records are minted.

### C6. Low — Listener stacking and stale cache in `subscribeLinkedHistories`

Every `linkedUids` snapshot re-runs the `uids.forEach` and attaches a **fresh** `on("value")` closure per uid — RTDB treats each distinct callback as a new listener, so after N membership changes each uid's history has up to N duplicate listeners, each firing a `softRender` per remote change. And a uid *removed* from the group keeps both its listener (until the server cancels it on the next permission re-check) and its `linkedHistoryCache` entry — merged Stats keep counting an unlinked device's games until reload. Low today only because membership changes are rare and unlink doesn't exist yet (finding #11 wants it to).

**Fix:** keep a `subscribedUids` set; attach only new uids, `off()` and `delete linkedHistoryCache[uid]` for departed ones, then `softRender()`.

### C7. Low — Null-sheet crash on late generate/redeem failures

`generateLinkCode`'s `.catch` and `redeemLinkCode`'s `onError` callbacks both assign `ui.linkDeviceSheet.error` without a null guard. Close the sheet (overlay tap / Android back) while the network call is in flight, then let it fail or time out → TypeError on null, from an unhandled promise rejection. One-line guard (`if (!ui.linkDeviceSheet) return;`) in each error path.

### C8. Low — Offline-archived records strand until the next archive

RTDB pending writes live in memory only: archive a game offline, reload before reconnecting, and the `set()` is gone. On the next boot nothing pushes — `syncHistoryToCloud` is only ever called from `saveHistory()` and `enableCloudSync()`, so the missing record sits local-only until the user next archives or deletes *something*. Cheap fix that also serves C1: call `syncHistoryToCloud()` at the end of `subscribeMyHistory`'s snapshot handler — the baseline was just seeded, the diff is exact, and the call is idempotent.

### C10. Medium — Linked-history listener is permanently cancelled by a personOf-propagation race (Fixed)

Surfaced by the unlink work's stress diagnostic (`unlink-stops-merging` failed with `B-in-A.linkedUids=true` yet merged games `0` — proving A's *membership* listener had fired but the *history* read still returned nothing). Mechanism: the `users/$uid` read rule authorizes a cross-read only when that uid's `personOf` reverse index points at the shared `personId`. But `redeemLinkCode` must write `linkedUids` **before** `personOf` (the hardened rules force it — `personOf`'s `.validate` requires the `linkedUids` entry to already exist, and rule `root` is evaluated pre-write so an atomic multi-path update can't collapse the two). The generator's `subscribeLinkedHistories` membership listener fires on that **first** write and immediately attaches an `on("value")` to `users/<joiner>/history` — which can land in the sub-second window **before** the joiner's `personOf` write propagates. Firebase cancels that read with PERMISSION_DENIED and **never retries a cancelled listen**, so the generator silently never merges the joiner's history for the rest of the session.

**Failure scenario:** A generates a code, B redeems it, both online. Intermittently (whenever A's listener wins the race against B's `personOf` write — a real production timing window, not just the test's), A's Personal Stats never pick up any game B plays, with no error surfaced. An app reload re-runs `subscribeLinkedHistories` when `personOf` is long-settled, masking it — which is likely why manual testing missed it.

**Fix applied:** `attachLinkedHistoryListener(uid)` supplies an error callback to the `on("value")`; on cancel it re-attaches (1.5s backoff, capped at `LINKED_HISTORY_MAX_RETRIES = 8`, budget refilled on any successful read), bounded so a genuinely malformed membership (a `linkedUids` entry with no matching `personOf`) can't spin forever. Regression-guarded by `unlink-stops-merging`/`link-and-sync-history`, which race a peer's gameplay immediately after linking — two-for-two green post-fix where they failed ~1-in-2 before.

### C9. Info — `!data` branch in `redeemLinkCode` is unreachable

`linkCodes/$code`'s read rule includes `data.exists()`, so reading a nonexistent (or expired) code **rejects with PERMISSION_DENIED** rather than resolving with a null snapshot — the `if (!data)` branch can never run, and the "No link code found." UX rests entirely on the `.catch` mapping (which is correct, and which the `invalid-link-code` stress scenario pins down). Keep it as belt-and-braces or drop it; either way a comment should say the catch branch is the real path, so a future rules edit doesn't silently change the UX.

### Code-quality notes (no defect, worth a pass before building further)

- **Subscription wiring is spread across three call sites** (boot block, `generateLinkCode`, `redeemLinkCode`) each doing a different subset of `subscribeMyHistory` / `subscribeLinkedHistories` / `syncHistoryToCloud` — C2 is a direct consequence. Making `enableCloudSync()` the single owner of all three (guarded on `authUid`/`personId`) removes the class of bug.
- **`linkedUids` local state has three writers** (`loadLinkedUids`, `generateLinkCode`'s concat, `subscribeLinkedHistories`'s replace). The concat in `generateLinkCode` is redundant the moment the subscription lands; with C2 fixed it can go.
- **`AUTH_UID_KEY` caching exists only to let boot race auth** — after C3's fix it's dead weight and can be deleted outright.

# Overnight Review Brief — Cloud History Sync / Device Linking

Review the uncommitted working-tree changes in this repo (branch `dev`, on top of
commit 4b2fe2a — run `git status`/`git diff` to see the full scope, nothing is
committed yet). This is a single feature: opt-in cloud sync + cross-device linking
for a card-game score tracker's Game History, built and iteratively debugged over
a same-day session. I want a full code review before this ships.

## What the feature does

- Every device gets a stable Firebase Anonymous Auth uid on boot (silent, no login
  UI). Opting in via Display sheet → "Back up my History" syncs the local
  `gameHistory` array to `users/<uid>/history` in Firebase Realtime Database.
- A separate "link this device" flow (reusing the app's existing tournament
  join-code UX) lets a second device redeem a short code and join the same
  `personId` group (`people/<personId>/linkedUids`), so Personal Stats can merge
  History across every device one person plays from.
- This is the one item that was on ROADMAP.md's "Ideas — not yet planned" list
  ("Account-based cloud sync for Game History").

## Files changed

- **`index.html`** — the whole feature: new state (`authUid`, `cloudSyncEnabled`,
  `personId`, `linkedUids`, `linkDeviceSheet`, `backupPrompt`), new functions
  (`initAuth`, `syncHistoryToCloud`, `subscribeMyHistory`, `enableCloudSync`,
  `generateLinkCode`, `redeemLinkCode`, `subscribeLinkedHistories`,
  `mergedHistoryForStats`, `maybeSuggestBackup`), and a `matchUid` field added to
  three existing record-building functions (`buildHistoryRecordForMatch`,
  `archiveCurrentGame`, `archiveManualWin`) so a shared match archived
  independently by two linked devices dedups correctly instead of double-
  counting in Stats.
- **`FIREBASE_SETUP.md`** — new `users`/`linkCodes`/`people`/`personOf` security
  rule blocks (additive; the existing `tournaments` block is untouched), plus
  an Anonymous Auth enablement step. **These rules are already published** to
  the live Firebase project — read them here rather than assuming test-mode/
  open rules.
- **`SECURITY_REVIEW.md`** — has a dated addendum ("Device Linking / Cloud History
  Backup — 2026-07-13") documenting two findings from this session: #7 (a
  personOf spoofing gap, already fixed) and #8 (an accepted, deferred gap —
  see below). **Read this addendum before starting** — it's the closest thing
  to a self-assessment of what's already known to be weak.
- **`stress-test/`** — new `scenarios/device-linking.js` (4 scenarios: invalid
  code, offline/no-opt-in fallback, link-and-sync-history, shared-match-not-
  double-counted), new `lib/pageobjects/linking.js` and `stats.js`, plus small
  additions to `storage.js` (new `KEYS`) and `orchestrator.js` (registration).
  Also `config.js`/`lib/browser.js` gained an `authThrottleMs` gate — every
  test device's boot-time anonymous sign-in is now paced at least 1.5s apart
  across the whole run. **Don't remove or shrink this** if you run the suite —
  it exists because hammering Firebase's real Anonymous Auth endpoint with
  dozens of rapid sign-ins tripped its own anti-abuse rate limiting mid-session
  today (surfaces as a 400 on every page load, app-wide, until it cools down).

## Already verified — don't re-derive, but don't just trust it either

`node stress-test/orchestrator.js --phase=all` passed 42/42 scenarios, 0
findings, on the final run of this session — full local-phase gameplay (all 4
tournament formats, casual, best-of-series, history export/import), the
existing sync-cross-cutting regression suite, and all 4 new device-linking
scenarios. This is real functional coverage, not a smoke test — worth
re-running to confirm, but I'd treat a fresh failure as informative rather
than assume the suite itself is broken.

Two real bugs were found and fixed via this suite during the session, both
now covered by regression scenarios:

1. `archiveCurrentGame`/`archiveManualWin` initially didn't set `matchUid`
   (only `buildHistoryRecordForMatch` did), so a shared match played out by
   the "active" device (not just the auto-archiving teammate) couldn't be
   deduped against a linked device's copy — inflated Stats counts.
2. A backup-nudge banner that originally lived in the shared `renderSyncBar`
   (rendered on every view, every render pass) popped up mid-tournament as
   soon as any earlier match archived to History, and disrupted a moon-shot
   deal's UI interaction in the stress-test simulator — confirmed via
   bisection against the clean baseline commit. Moved to fire only on the
   History tab.

## What I actually want reviewed (i.e. what ISN'T already covered above)

1. **Adversarial security review of the new Firebase rules**, not just
   functional correctness. Finding #8 in the SECURITY_REVIEW.md addendum is a
   known, accepted gap I did NOT fix: `people/$personId/linkedUids/$uid`'s
   write rule only checks `auth.uid === $uid`, with no proof that the device
   ever redeemed a valid `linkCodes` entry for that `personId` — a client
   speaking the REST/SDK API directly could self-join any group it can name
   or guess, then pass the (already-fixed) `personOf` membership check
   legitimately. I judged this low-severity (personId is an unguessable
   random string never shown in the UI) but want a second opinion, and want
   you to hunt for anything else in the same family I didn't catch — re-read
   all four new rule blocks adversarially, not just the two already flagged.
2. **Code quality / simplification** in index.html's new functions — this was
   built and debugged iteratively under time pressure; there may be dead
   code, redundant state, or opportunities to simplify that a fresh read
   would catch better than continuing to build on it would.
3. **Edge cases the 42 stress-test scenarios don't reach** — e.g. what
   happens if a device un-links (there's no unlink flow — is that a gap or
   fine?), concurrent link-code redemption races, a device with
   `cloudSyncEnabled` that goes offline mid-sync, or malformed/partial
   Firebase data arriving mid-subscription.
4. **General correctness** of the index.html diff — most confidence is in the
   parts the stress suite directly exercises and least in anything it
   doesn't (error paths, the offline fallback, boot-sequence ordering).

Report findings the way the existing SECURITY_REVIEW.md/stress-test artifacts
are formatted (severity, concrete failure scenario, suggested fix) so they
slot into the existing docs rather than becoming a separate free-floating
report.

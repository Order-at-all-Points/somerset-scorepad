# Security Review — SomeRSet Scorepad

**Date:** 2026-06-22
**Scope:** `index.html` (single-page app), Firebase Realtime DB rules (`FIREBASE_SETUP.md`), repo config (`.env.local`, `.gitignore`, `.vercelignore`).
**Reviewer:** Claude (time-boxed review)

---

## Summary

The app is a static, client-only scorekeeper with an optional Firebase Realtime Database sync layer keyed on a 6-character share code. No server-side code, no auth. Overall the client-side XSS surface is **well contained** — the one dangerous sink is never reached. The meaningful risks are all in the **open, no-auth Firebase backend** and its security rules, plus one config-hygiene issue around deploy ignore rules.

| # | Severity | Issue |
|---|----------|-------|
| 1 | **Medium** | `_createdAt` is unvalidated in the rules → 48h expiry trivially bypassed; records can be made permanent |
| 2 | **Medium** | Open, no-auth backend: anyone can read/write/overwrite any code → quota abuse, data tampering, lost updates |
| 3 | **Low** | Share codes generated with `Math.random()` (non-cryptographic); codes are the *only* access control |
| 4 | **Low** | `.vercelignore` only excludes `*.md` — does not exclude `.env*`/`.vercel`, risking deploy-time exposure |
| 5 | **Info** | No data-size/shape validation in rules → oversized-payload quota abuse |
| 6 | **Info** | XSS sinks reviewed and found safe (documented for assurance) |

---

## Findings

### 1. Medium — Security rules don't validate `_createdAt`; expiry & access window are bypassable

The read/write rules gate everything on `(now - data.child('_createdAt').val()) < 172800000` (48h). Legitimate clients set `_createdAt` via `firebase.database.ServerValue.TIMESTAMP` (index.html:472, :872), but the **rules never constrain what `_createdAt` may be**. A client talking to the REST/SDK API directly can write any value:

- Set `_createdAt` to a **future** timestamp → `now - _createdAt` is negative, always `< 172800000` → the record **never expires** and stays readable/writable indefinitely, defeating the central "auto-cleans after 48h" guarantee that the whole design leans on.
- This converts the transient quota cost of finding #2 into a **permanent** one.

**Fix:** add a `.validate` on `_createdAt` for new records, e.g. require `newData.child('_createdAt').val() <= now && newData.child('_createdAt').val() >= now - 60000` (server-time on create), and forbid changing it on update (`!data.exists() || newData.child('_createdAt').val() === data.child('_createdAt').val()`).

### 2. Medium — Open, no-auth backend (read/write/overwrite any code)

Confirmed and consistent with the prior review note. The rules allow **any** anonymous caller to create, read, and overwrite **any** tournament code inside the 48h window. Consequences:

- **Data tampering:** anyone who learns/guesses a code can overwrite live scores. There is no writer identity or per-match authorization at the rules level (the in-app "lock" lives inside the same clobbered object, so it is advisory only).
- **Lost updates:** `saveTourney` (index.html:473) and `startSharedTournament` (index.html:875) persist the whole record with `.set()`. Concurrent writers → last-write-wins, silent loss.
- **Code collision overwrite:** `startSharedTournament` calls `genCode()` then `.set()` **without checking existence** (index.html:870–875). A ~1-in-10⁹ collision (or a deliberate one) silently destroys an existing tournament.
- **Quota abuse:** unauthenticated mass-create burns free-tier quota.

**Fix (design):** introduce light auth (Firebase Anonymous Auth) and scope writes to participants; use `transaction()` / granular `update()` for per-match writes; on create, use a `transaction` or `update` with a `!data.exists()` guard to avoid clobbering.

### 3. Low — Share codes use `Math.random()`, the sole access control

`genCode()` builds the 6-char code from `Math.random()` (index.html:598–600); device IDs and team IDs likewise (index.html:541, :1784, :2407). `Math.random()` is **not cryptographically secure** and its internal state is observable/predictable in-engine. Because the code is the *only* thing protecting a tournament (finding #2), weak generation lowers the bar for an attacker who can observe sample outputs to narrow guesses.

**Fix:** generate codes with `crypto.getRandomValues()`.

### 4. Low — `.vercelignore` doesn't exclude `.env*` / `.vercel`

`.vercelignore` contains only `*.md`. `.gitignore` correctly excludes `.env*`, `.vercel`, and `.DS_Store`, but **`.vercelignore` is independent of `.gitignore`**. `.env.local` currently holds a `VERCEL_OIDC_TOKEN` (short-lived, but a live credential). For a static deployment this risks uploading dotfiles/credentials into the deployment bundle.

**Fix:** add `.env*`, `.vercel`, and `.DS_Store` to `.vercelignore`. (The committed Firebase `apiKey` in index.html is **not** a secret — that is normal and safe for Firebase web apps.)

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

1. Add `.env*` / `.vercel` to `.vercelignore` (one line, immediate). — #4
2. Validate `_createdAt` (and ideally freeze it on update) in the rules. — #1
3. Switch `genCode()` to `crypto.getRandomValues()`. — #3
4. Plan the auth + granular-write refactor for tamper/lost-update resistance. — #2/#5

Items #1, #3, #4 here are quick wins; #2's full fix is a deliberate design decision (previously documented as an accepted tradeoff for a casual app).

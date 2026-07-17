---
name: verify
description: How to run and verify SomeRSet end-to-end — static server, Playwright page objects, and (for cloud features) local Firebase emulators with the repo's security rules loaded.
---

# Verifying SomeRSet

Single-file PWA (`index.html`), no build step. Surface = browser GUI.

## Serve + drive

- Static server: `node -e 'require("./stress-test/server.js").start()'` → `http://127.0.0.1:8934/index.html` (must be http://, not file://, or the Firebase SDK scripts are blocked).
- Playwright is in `node_modules` (chromium installed). Reuse `stress-test/lib/pageobjects/*` — seats, sync (share/join/identify), nav, newGame, stats, linking (Display sheet, Cloud Backup toggle), storage (localStorage keys) — and `stress-test/lib/simulator.js` (`playDealsToCompletion` plays a full game fast). `stress-test/scenarios/casual-shared.js` is the canonical host+guest shared-game flow to crib from.
- Console 404s for `/_vercel/insights/script.js` and `/_vercel/speed-insights/script.js` are pre-existing local-serve noise — filter them, don't report them.

## Cloud features against local Firebase emulators (not production)

Every device the stress-test harness creates (`stress-test/lib/browser.js`
`createDevice()`) wires itself to the local Firebase emulators by default —
no phase (local/sync/sharing) ever writes to production anymore (see
rate-limit notes in `stress-test/config.js` — authThrottleMs, sync
concurrency 1, both still relevant if you ever point a manual run at
production). A full `node stress-test/orchestrator.js` run needs the
emulators up or it skips every phase with a loud notice instead of running.
To bring them up:

1. **JDK 21+** needed (firebase-tools hard-fails below 21: "no longer supports Java
   version before 21") and the machine only has Java 8 — a standalone JDK works
   without touching the system:
   `curl -sL -o jdk21.tgz "https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jdk/hotspot/normal/eclipse" && tar xzf jdk21.tgz`
   then `export JAVA_HOME="$PWD/jdk-21*/Contents/Home"; export PATH="$JAVA_HOME/bin:$PATH"`.
2. Extract the rules JSON from FIREBASE_SETUP.md's ```json fence into
   `database.rules.json` (extract programmatically — pick the fence that parses
   and has a `.rules` key; never transcribe by hand, or the emulator stops
   enforcing what production enforces); write a `firebase.json` enabling
   `database` (9000) + `auth` (9099) emulators; in a scratch dir put a minimal
   `package.json` first (without one, `npm i firebase-tools` can silently install
   nothing), then `npm i firebase-tools` and
   `./node_modules/.bin/firebase emulators:start --only database,auth --project demo-somerset`.
3. Point the app at the emulators via Playwright route interception on
   `**/index.html` (three string replacements):
   - `databaseURL` → `http://127.0.0.1:9000?ns=demo-somerset-default-rtdb`
   - `projectId` → `demo-somerset`
   - append after the config object literal:
     `firebase.initializeApp(window.SOMERSET_FB_CONFIG); firebase.auth().useEmulator("http://127.0.0.1:9099");`
     (the app's own initAuth/initFb then skip re-init).
4. **Launch chromium with `args: ['--disable-features=LocalNetworkAccessChecks']`** —
   headless Chrome otherwise auto-denies page→loopback fetches and anonymous
   auth never resolves (CORS error naming the "loopback address space").
5. Wait for `localStorage["somerset:dev-auth-uid"]` to appear before driving
   any cloud UI (Cloud Backup toggle no-ops with a "Couldn't connect" toast
   until anonymous auth resolves).
6. Emulator DB is rules-enforced but freely inspectable/resettable with
   `?access_token=owner`: e.g.
   `curl "http://127.0.0.1:9000/statsProfiles.json?ns=demo-somerset-default-rtdb&access_token=owner"`.

A full worked example (two contexts, shared game, stats-sharing follow/revoke,
rules-denial probes): `.claude/skills/verify/examples/verify-sharing-emulator.js`.

## Gotchas

- Two "devices" = two BrowserContexts (isolated localStorage). Disable the
  service worker via addInitScript (see `stress-test/lib/browser.js`).
- Sheets block re-renders (`sheetOpen()`); incoming sync lands after the sheet
  closes — poll, don't assume a fixed settle.
- localStorage keys are all `somerset:dev-*` (profile id, share peers, auth
  uid, history…) — reading them is the fastest state oracle.

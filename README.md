# SomeRSet Scorepad

A mobile-first scorepad for the partnership card game **Some‑R‑Set** (a Setback / Auction Pitch variant). Keep score for a casual four‑player game, archive completed games, or run a full multi‑round tournament — with live cross‑device syncing so everyone can log hands from their own phone.

**Live app:** [somerset-scorepad.vercel.app](https://somerset-scorepad.vercel.app)

The entire application is a single, dependency‑free `index.html` file: vanilla JavaScript, inline CSS, no build step. It runs as an installable iOS/Android web app (add to home screen) and works offline for solo games.

---

## Table of contents

- [What it does](#what-it-does)
- [Install on your phone (add to Home Screen)](#install-on-your-phone-add-to-home-screen)
- [The game & scoring rules](#the-game--scoring-rules)
- [Features](#features)
  - [Game tab](#game-tab)
  - [History tab](#history-tab)
  - [Personal Stats](#personal-stats)
  - [Tournament tab](#tournament-tab)
  - [Shared / multi-device games](#shared--multi-device-games)
  - [Options and Settings menus](#options-and-settings-menus)
  - [Cloud Backup & device linking](#cloud-backup--device-linking)
  - [Stats Sharing](#stats-sharing-follow-people-you-play-with)
- [Architecture](#architecture)
- [Data & storage](#data--storage)
- [Running locally](#running-locally)
- [Firebase setup](#firebase-setup)
- [Deployment](#deployment)
- [Project layout](#project-layout)
- [Roadmap](#roadmap)

---

## What it does

SomeRSet replaces the pad of paper you'd otherwise keep next to the table. It handles the arithmetic that trips people up in bid‑and‑set games — subtracting the bid when a team is set, jumping to 50 on a made moon, and rotating the dealer — and then extends that into history tracking and bracket‑based tournaments for larger gatherings.

Three top‑level tabs:

| Tab | Purpose |
| --- | --- |
| **Game** | A single **Standard** game between two teams of two. |
| **History** | An archive of completed games (rosters, winner, score, hand log) plus Personal Stats. |
| **Tournament** | Multi‑team brackets and round robins, optionally synced across devices. |

There are exactly two modes a player can start: **Standard** (the Game tab) and **Tournament**. Both can be shared live across phones.

---

## Install on your phone (add to Home Screen)

There's nothing to download from an app store — SomeRSet is a Progressive Web App. Adding it to your Home Screen gives you a full‑screen, app‑like icon (no browser chrome), and solo games keep working offline.

### iOS / iPadOS (Safari)

> Use **Safari** — the Add to Home Screen option isn't available in Chrome or other browsers on iOS.

1. Open **[somerset-scorepad.vercel.app](https://somerset-scorepad.vercel.app)** in Safari.
2. Tap the **Share** button — the square with an upward arrow (in the bottom toolbar on iPhone, the top bar on iPad).
3. Scroll down in the share sheet and tap **Add to Home Screen**.
4. Optionally edit the name, then tap **Add** (top‑right).
5. Launch SomeRSet from the new Home Screen icon. It opens full‑screen, like a native app.

### Android (Chrome)

1. Open **[somerset-scorepad.vercel.app](https://somerset-scorepad.vercel.app)** in Chrome.
2. Tap the **⋮** menu (top‑right).
3. Tap **Add to Home screen** (or **Install app**), then confirm.

> Once installed, the app runs in standalone mode. Solo games and history are stored on the device and work with no connection; shared tournaments, Cloud Backup, and Stats Sharing still need network access to sync.

---

## The game & scoring rules

Some‑R‑Set is played by **4 players in two fixed partnerships**, seated alternately clockwise (seats 0 & 2 are one team, seats 1 & 3 the other). Each deal a team **bids**, names a **trump**, and tries to take at least as many points as it bid. The scorepad encodes these rules:

- **Points per deal:** 14 are available each hand (`POINTS_PER_DEAL = 14`).
- **Target to win:** first team to **50** points.
- **Making the bid:** if the bidding team takes at least its bid, both teams score the points they actually took.
- **Set penalty:** if the bidding team falls short, it is *set* — it **loses its bid** (the bid is subtracted from its score). Scores can go **negative**.
- **Shoot the moon:** bidding the full **14** and taking all **14** jumps the bidding team straight to **50** (an instant win) — but only if its running score was **≥ 0** before the hand. If the team was negative, the moon is scored as ordinary points instead.
- **Moon Shot rules (Classic / Instant Death):** an opt-in tournament-style variant that makes the moon's risk match its reward. Classic (default) is today's rule — a made moon is an instant win, a missed one just scores as a normal set. Instant Death adds the mirror case: missing the moon with a running score that was ≥ 0 before the hand is an instant loss, ending the game immediately for the other team. For a solo game, chosen from the ☰ Settings menu's "Moon Shot" row (opens a picker explaining both modes), changeable anytime — with a "Just this game" vs. "From now on" choice once hands are already recorded. Both take effect from the next hand of the game in progress; they differ only in whether the device-wide default for future games moves with it. Neither is retroactive, so past hands are never reinterpreted. For a tournament, chosen once as a Classic/Instant Death toggle on the setup screen (under the format pills) and **locked for the tournament's entire lifetime** — every round plays under the same rule, and the Settings row then just displays which mode is in effect, padlocked and untappable rather than editable.
- **Dealer rotation:** the dealer advances one seat clockwise every deal; a seat diagram shows whose turn it is. Player and seat names are editable, with one‑tap quick‑add from the per‑device name book.

> **Trump is not recorded.** Naming trump is part of the table game, but the entry chips, summary text, and stored `trump` field are commented out in `index.html` pending more work — a hand is captured as bidder + bid + points taken. Hand entry's two steps are **Record Bid** and **Record Take**, not bid → trump.

Scoring is computed by threading the running total through every deal (`gameTotals` / `gameWinner`), so moon and set outcomes always reflect the score *at that moment*.

---

## Features

### Game tab

- **Two‑phase hand entry, shared across devices.** **Record Bid** captures who bid and the bid, then returns everyone to the scoreboard — the pending bid lands on the hand table (with blank score columns) so every spectator sees it live while the hand is played. Once the hand is done, **any** device can tap **Record Take** to enter the points taken; the score and hand history then update for everyone at once. (Editing an already‑recorded deal keeps both steps in one flow on the editing device.)
- Automatic set handling (bid subtracted, may go negative) and shoot‑the‑moon win detection.
- Live running totals with progress bars toward 50.
- Clockwise dealer rotation with a seat diagram; tap a seat → **Edit name** to type a name or **quick‑add** one from the per‑device name book (with an **Edit/Done** toggle to delete saved names). Names saved here are remembered for next time.
- Names must be **unique within a roster** — the app blocks two seats (or two players in a tournament roster) from sharing an identical name, so seat lookup and stats always resolve to the right person.
- **Archiving is automatic.** The moment a game is decided it's written to History — there's no "save this?" prompt. A **Play again?** sheet then offers *Rematch, same teams* / *Redraw teams and play again* / *No thanks*.
- An **Options** pill under the pad holds everything else: New Game, Share Join Code, Join With Code, Playing as…, and (in a shared game) Share code and End/Leave. See [Options and Settings menus](#options-and-settings-menus).

### History tab

- A **Log / Stats** switcher at the top of the tab chooses between the game archive and [Personal Stats](#personal-stats).
- **Filter pills** narrow the log: **All**, **Today**, **Standard**, **Tournament**.
- Completed games are archived with **rosters, winner, final score, and date**.
- Entries are grouped **by day**, and each day's tournament matches are further collapsed into their own **tournament group** — tap either a day or a tournament header to collapse/expand it. Collapsed rows show a summary: games played, each team's win‑loss record, and the champion (if the tournament finished).
- Tap an entry to expand the full **hand‑by‑hand log**.
- Delete entries you no longer want.
- **Export / Import** — back up your History to a JSON file, or restore it (e.g. after reinstalling the app or switching phones). Importing merges into your existing History and skips games already present, so it's safe to import the same file twice.

### Personal Stats

The **Stats** half of the History tab's Log/Stats switcher opens a cross‑player leaderboard, computed entirely from existing game History — no new data, works retroactively on games already logged.

- **Leaderboard** — sortable by **Games Played / Wins / Moons / Streak**; each row's secondary figure adapts to the active sort (win % under Wins and Games Played, games played under Moons, "longest" under Streak).
- **Per‑player detail tiles** — games played, championships, longest winning streak, longest losing streak, current streak, times set, biggest win margin, moons shot, moon shot success rate, average bids per game, and average points per bid.
- **Charts** — a recent‑form strip, a **Form trend** line (win percentage over a trailing window), a win/loss bar, and a games‑by‑month chart (tap the heading to toggle per‑month counts).
- **Win rate by format** — casual vs. single elim vs. double elim vs. round robin, shown once a player has played more than one.
- **Highlights** — biggest win margin, nailbiter, comeback win, Hail Mary (a made moon while trailing by the most points), longest and shortest game, each tappable to open that game's full hand‑by‑hand log.
- **Best partner** / **toughest opponent ("nemesis")** — best and worst joint/head‑to‑head records, minimum two games together.
- **Merge names…** — fold a typo'd or nicknamed entry ("Daniel" → "Dan") into one canonical player, with a per‑merge undo. Stored as a per‑device alias map that stats resolve through before bucketing games; the underlying History records are never rewritten.
- **Split a name…** — the inverse of Merge, for when two *different* people share one name (e.g. two friends both named "Sam"): pick the name, select which of its games actually belong to the other person, and give them a new name. Scoped to just those games, with its own undo, and — like Merge — never rewrites History.

### Tournament tab

Run a tournament for **6 or more players** (even counts; odd team counts get random byes that auto‑advance):

1. **Pick player count** → enter names. A per‑device **Quick‑add name book** remembers and de‑dupes names you've typed before.
2. **Choose a format** and the **Moon Shot** rule:
   - **Single Elim** — flowchart bracket; pick winners manually or play each match in‑app.
   - **Double Elim** — winners + losers brackets with a grand final (handles the tricky 5‑ and 6‑team losers‑bracket cases).
   - **Round Robin** — standings table plus a schedule grid.
   - A **Classic / Instant Death** segmented control directly under the format pills sets the moon rule for the whole tournament. Chosen once and **locked for the tournament's lifetime** — see [the rules section](#the-game--scoring-rules).
3. **Random team draw** — players are paired into teams of two, re‑drawable before you start.
4. **Play matches** — each match has its own independent game. Play or resume a match; the winner auto‑advances and the completed game is archived to History. The match scoreboard shows each team's combined player‑pair name (e.g. *Ted & Dan*); long names wrap onto two balanced lines so the two scores stay aligned.
5. At the end, **Rematch** (same teams) or **Redraw** (same players, new teams).

An **Options** pill sits at the bottom of the bracket and of match play, reachable whether or not the tournament is shared.

> **There is no Best‑of Series mode.** It was removed on 2026‑07‑22 — its escalation offers, length tracking, and record‑rewriting machinery touched nearly every game‑completion path for too little benefit. The internal `format: "series"` tournament shape survives at `bestOf: 1` purely as the sync wrapper a shared Standard game rides on, never as a user‑facing mode. Games logged under the old mode keep their deals, scores, and grouping: `isTournamentRecord()` classifies every `format: "series"` record as a **Standard** game, so nothing stored was rewritten and their championship flags simply stopped counting in stats.

### Shared / multi-device games

Both a tournament and a Standard game can be **synced live across phones** via Firebase Realtime Database:

- Sharing generates a short, friendly **6‑character join code** (e.g. `K7MXQ2`), shown with a tap‑to‑copy button. A tournament is shared from its Options pill; a Standard game from **Options → Share Join Code**, which wraps the game in the same machinery behind the scenes.
- Other players join via **Options → Join With Code** on either tab.
- All updates sync simultaneously across devices, **siloed per session**.
- **Per‑hand locks** — a lock is claimed only for the specific hand someone currently has open for editing, not the whole match, so two devices can enter different hands of the same game at once.
- Shared sessions **stop accepting changes after 48 hours**, then remain **readable for 30 days** before deletion (enforced by Firebase security rules). That gap lets someone who was offline when a game finished rejoin the code later and have it land in their own History. Past the write window the session renders as **Archived: read‑only** — editing affordances disappear rather than failing with a confusing lock error.
- A decided game that's **corrected afterwards** self‑heals on every device that already archived it: the correction is adopted into the existing record in place, keeping its id and archive date, never adding a duplicate.
- The name book stays **local** to each device.
- **"Which player are you?"** — after starting or joining a shared session, tag yourself with your name from the roster (or set it later via **Playing as** in the sync bar). Every match you're in then lands in *your own* History automatically as it's completed — even ones a teammate enters the score for — with no duplicate entries if you also played/recorded it yourself. Once any player in a shared session is named the prompt can't be dismissed without a decision, though **"I'm just spectating"** is a valid explicit opt‑out.

### Options and Settings menus

Two menus, split by scope: **Options** is about the session in front of you, **☰ Settings** is about the device.

**Options** — a pill at the bottom of the Game tab, the History tab, the Stats board, the bracket, and match play. Its contents adapt to context:

| Context | Buttons |
| --- | --- |
| Game tab, unshared | New Game (once hands exist), Share Join Code, Join With Code, Playing as… |
| Game tab or Tournament, shared | Share code / Retry sharing, Playing as…, End or Leave |
| History tab | Export Game History, Import Game History, Merge/Split Names (on the Stats board) |

**☰ Settings** — the hamburger in the header:

| Row | What it does |
| --- | --- |
| **Appearance** | Auto / Dark / Light theme pills. |
| **Playing as** | This device's persistent identity, reused across every game. |
| **Cloud Backup** | Toggle plus a row that opens device linking. |
| **Stats Sharing** | On/Off summary; opens the sharing sheet and its People list. |
| **Moon Shot** | Classic / Instant Death. Padlocked and untappable while a tournament is active, since a tournament's mode is locked at setup. |
| **Share App** | Share a link to the app. |
| **Add App to Home Screen** | Install prompt; hidden once already installed. |

### Cloud Backup & device linking

Opt-in, via **☰ → Cloud Backup**:

- **Turn on backup** saves this device's game History to the cloud (anonymous Firebase Authentication — no account or sign‑up), so it survives a lost or replaced phone.
- **Link another device** — one device shows a short code, the other enters it, and from then on both devices' History merges automatically: play a casual game on either phone and it shows up in Stats/History on both.
- **Turn off backup & unlink** stops backing up and leaves the linked group; this device keeps its own copy of History, other linked devices keep theirs.
- Required by **Stats Sharing** below, since following someone else's stats needs a stable, signed‑in identity to publish to.

### Stats Sharing (follow people you play with)

Opt-in, via **☰ → Stats Sharing** (requires Cloud Backup):

- While on, anyone you play a **shared game** with is followed automatically after the first match: their **overall record** — wins, moons, sets, streaks, recent form, career totals from *every* game they record anywhere — appears as a live **"Overall record — shared live"** section on their Stats page on your device, and stays current as they play.
- Their **highlight games** (biggest win, nailbiter, comeback win, Hail Mary, longest game, shortest game) are shared as full records and open **hand-by-hand** with a tap — the same interaction the local Stats page's Highlights rows have.
- **Third-party names stay private by default**: shared highlight games arrive with the roster stripped (hands and scores still show, seats read "Seat 1…4"). A separate **"Include names in shared games"** toggle shares the full table for groups where everyone knows everyone — off, because the people in your games don't pick your followers.
- It's **mutual but independently controlled**: the same first match shares your record with them, and the **People list** in the Stats Sharing sheet has a per-person toggle — flip someone off and their access is revoked immediately (enforced by Firebase security rules, not just hidden in the UI). Unfollow anyone from the same list or from their Stats page.
- Your local Stats table is untouched — it still counts only games in your own History; the shared record is shown alongside, clearly labeled, so nothing double-counts.
- If two different people you've played with happen to share a name, the app won't silently follow the wrong one — it asks you to confirm whether a new match is the same person or someone else before following.

---

## Architecture

- **Single file.** Everything lives in `index.html` — markup, CSS in a `<style>` block, and the app in one IIFE `<script>`. No framework, no bundler, no transpile step.
- **Vanilla DOM rendering.** A small `el()` helper builds elements; a top‑level `render()` redraws the active view from a single `ui` state object plus the `game` / `gameHistory` / `tourney` data.
- **Offline‑first.** Solo games and history persist to `localStorage` and need no network.
- **Optional realtime backend.** Firebase Realtime Database (loaded from the gstatic CDN, compat build) powers shared tournaments, Cloud Backup/device linking, and Stats Sharing; if no config or network is present, solo games and local History still work fully offline.
- **PWA shell.** iOS/Android standalone meta tags, a service worker for offline app‑shell caching, and light/dark app icons.
- **No web fonts.** The felt‑table look is built from system stacks only — a serif display face (`ui-serif` / New York / Iowan Old Style / Georgia), the platform UI sans for body text, and `ui-monospace` for tabular numerals. Nothing is fetched from a font CDN, so the shell renders identically offline.
- **Themes.** A `data-theme` attribute on the root drives CSS custom properties; the Settings sheet exposes **Auto / Dark / Light**. Two earlier "Classic" variants remain in the stylesheet but are filtered out of the picker.

---

## Data & storage

Client state is kept under `localStorage` keys — all prefixed `somerset:dev-` except the theme preference, which predates the convention:

| Key | Contents |
| --- | --- |
| `somerset:dev-v1` | The current solo game. |
| `somerset:theme-pref` | Appearance choice (`auto` / `aubergine` / `aubergine-light`). |
| `somerset:dev-history` | Archived completed games. |
| `somerset:dev-tournament` | The active tournament (mirrored to Firebase when synced). |
| `somerset:dev-names` | Per‑device Quick‑add name book (max 60). |
| `somerset:dev-sync-code` / `somerset:dev-sync-role` | Current tournament join code and host/guest role. |
| `somerset:dev-device-id` | Random per‑device id used for match locks. |
| `somerset:dev-my-name` | Which roster name is "me" for the active join code, so tournament matches auto‑archive to History. |
| `somerset:dev-my-device-name` | Persistent device‑wide "Playing as" identity, reused silently across every game. |
| `somerset:dev-identity-nudge-seen` | Whether the one‑shot "is this you?" prompt has already been shown. |
| `somerset:dev-instant-death-moon` | Device‑wide default Moon Shot mode for new Standard games. |
| `somerset:dev-archived-matches` | Set of match ids already archived to this device's History, so auto‑sync never double‑adds one. |
| `somerset:dev-name-aliases` / `somerset:dev-name-splits` | Stats' **Merge names…** and **Split a name…** maps — display‑only, never rewrite History. |
| `somerset:dev-auth-uid` | This device's anonymous Firebase Auth uid, once Cloud Backup or Stats Sharing has been used. |
| `somerset:dev-cloud-sync-enabled` | Whether Cloud Backup is on for this device. |
| `somerset:dev-person-id` / `somerset:dev-linked-uids` | Which linked‑device group this device belongs to, and its member uids, once devices are linked. |
| `somerset:dev-history-tombstones` | Locally‑deleted History entries, so a linked device doesn't resurrect them from its own cloud copy. |
| `somerset:dev-dirty-history` | Records edited since their last cloud push, so a correction isn't left stale in the cloud copy. |
| `somerset:dev-pending-revoke-all` | A sharing revocation that couldn't reach the network yet, retried on the next connection. |
| `somerset:dev-profile-id` / `somerset:dev-share-peers` / `somerset:dev-auto-share` / `somerset:dev-share-game-names` | Stats Sharing: this device's published‑stats profile id, the People list of peers you follow/share with, the master share toggle, and the "include names" opt‑in. |

In Firebase, tournaments are stored under `tournaments/<code>` with a `_createdAt` server timestamp. Security rules require a valid `format` (`single` / `double` / `round` / `series` — the last being the internal wrapper for a shared Standard game, not a user‑facing mode) and a `teams` field, and put each record on two clocks: **writable for 48 hours** after creation, then frozen, and **readable for 30 days**, so a participant can still rejoin an old code to repair or back-fill their own History. Cloud Backup, device linking, and Stats Sharing add further per‑user paths (`users/<uid>`, `statsProfiles/<profileId>`, etc.), each with their own rules. See [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md). If two people who played the same games ever see different numbers, [`SYNC_TROUBLESHOOTING.md`](SYNC_TROUBLESHOOTING.md) is the runbook for tracking it down.

---

## Running locally

No build step is required. Serve the directory with any static server so the Firebase CDN scripts load over HTTP:

```bash
# from the repo root
npx serve .
# or
python3 -m http.server 8000
```

Then open the served URL (e.g. `http://localhost:8000`). Opening `index.html` directly via `file://` works for solo play but may block the Firebase scripts.

> Solo games and history work with no configuration. Shared tournaments, Cloud Backup, and Stats Sharing require a Firebase Realtime Database — see below.

---

## Firebase setup

Shared tournaments, Cloud Backup/device linking, and Stats Sharing all need a Firebase Realtime Database. The full walkthrough — creating the project, enabling the database, pasting your `firebaseConfig`, and publishing the security rules — is in **[`FIREBASE_SETUP.md`](FIREBASE_SETUP.md)**.

The config lives in `index.html` as a `window.SOMERSET_FB_CONFIG` object. Only `databaseURL` is strictly required for syncing to work.

---

## Deployment

The app is deployed as a static site on **Vercel**:

```bash
npx vercel --prod
```

`.vercelignore` excludes the Markdown docs from the deployed bundle, and `.gitignore` keeps local Playwright/dev artifacts out of the repo. Any static host (Netlify, GitHub Pages, S3, etc.) works equally well — there is nothing to build.

---

## Project layout

```
SomeRSet/
├── index.html            # The entire application (HTML + CSS + JS)
├── sw.js                 # Service worker — offline app-shell caching
├── manifest.webmanifest  # PWA manifest (icons, standalone display)
├── icon-*.png            # App icons (light/dark pairs, 192/512)
├── README.md             # This file
├── ROADMAP.md            # Shipped features and future plans
├── FIREBASE_SETUP.md     # Step-by-step Firebase Realtime Database setup
├── SECURITY_REVIEW.md    # Security review of the Firebase backend & client
├── SYNC_TROUBLESHOOTING.md          # Runbook: diagnosing a cross-device History/Stats discrepancy
├── CLOUD_SYNC_STRESS_2026-07-16.md  # Findings from a cloud-sync stress sweep
├── archive/              # Superseded review docs, kept for provenance
├── stress-test/          # Playwright E2E harness — page objects, scenarios, oracle, orchestrator
├── package.json          # Dev-only (Playwright, used by the stress-test harness)
└── .vercelignore         # Excludes *.md from the Vercel deploy
```

Everything outside `index.html`, `sw.js`, `manifest.webmanifest`, and the icons is development material — the deployed bundle is those few files.

---

## Roadmap

See [`ROADMAP.md`](ROADMAP.md) for the full list, including features that shipped and were later removed. Shipped highlights include the single‑game scorepad, game history, Personal Stats, all three tournament formats, the shared multi‑device backend, Cloud Backup/device linking, Stats Sharing, and the Classic/Instant Death Moon Shot rules.

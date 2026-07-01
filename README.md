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
  - [Tournament tab](#tournament-tab)
  - [Shared / multi-device tournaments](#shared--multi-device-tournaments)
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
| **Game** | A single casual game between two teams of two. |
| **History** | An archive of completed games (rosters, winner, score, hand log). |
| **Tournament** | Multi‑team brackets and round robins, optionally synced across devices. |

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

> Once installed, the app runs in standalone mode. Solo games and history are stored on the device and work with no connection; shared tournaments still need network access to sync.

---

## The game & scoring rules

Some‑R‑Set is played by **4 players in two fixed partnerships**, seated alternately clockwise (seats 0 & 2 are one team, seats 1 & 3 the other). Each deal a team **bids**, names a **trump**, and tries to take at least as many points as it bid. The scorepad encodes these rules:

- **Points per deal:** 14 are available each hand (`POINTS_PER_DEAL = 14`).
- **Target to win:** first team to **50** points.
- **Making the bid:** if the bidding team takes at least its bid, both teams score the points they actually took.
- **Set penalty:** if the bidding team falls short, it is *set* — it **loses its bid** (the bid is subtracted from its score). Scores can go **negative**.
- **Shoot the moon:** bidding the full **14** and taking all **14** jumps the bidding team straight to **50** (an instant win) — but only if its running score was **≥ 0** before the hand. If the team was negative, the moon is scored as ordinary points instead.
- **Trump:** entered per hand as *No trump* or **1–6** (a two‑step bid → trump entry flow).
- **Dealer rotation:** the dealer advances one seat clockwise every deal; a seat diagram shows whose turn it is. Player and seat names are editable, with one‑tap quick‑add from the per‑device name book.

Scoring is computed by threading the running total through every deal (`gameTotals` / `gameWinner`), so moon and set outcomes always reflect the score *at that moment*.

---

## Features

### Game tab

- Two‑step hand entry: pick the bidding team and bid, then enter trump and points taken.
- Automatic set handling (bid subtracted, may go negative) and shoot‑the‑moon win detection.
- Live running totals with progress bars toward 50.
- Clockwise dealer rotation with a seat diagram; tap a seat → **Edit name** to type a name or **quick‑add** one from the per‑device name book (with an **Edit/Done** toggle to delete saved names). Names saved here are remembered for next time.
- **New Game** resets the pad; a finished game is offered for archiving to History.

### History tab

- Completed games are archived with **rosters, winner, final score, and date**.
- Tap an entry to expand the full **hand‑by‑hand log**.
- Delete entries you no longer want.
- **Export / Import** — back up your History to a JSON file, or restore it (e.g. after reinstalling the app or switching phones). Importing merges into your existing History and skips games already present, so it's safe to import the same file twice.

### Tournament tab

Run a tournament for **6 or more players** (even counts; odd team counts get random byes that auto‑advance):

1. **Pick player count** → enter names. A per‑device **Quick‑add name book** remembers and de‑dupes names you've typed before.
2. **Random team draw** — players are paired into teams of two.
3. **Choose a format:**
   - **Single Elimination** — flowchart bracket; pick winners manually or play each match in‑app.
   - **Double Elimination** — winners + losers brackets with a grand final (handles the tricky 5‑ and 6‑team losers‑bracket cases).
   - **Round Robin** — standings table plus a schedule grid.
4. **Play matches** — each match has its own independent game. Play or resume a match; the winner auto‑advances and the completed game is archived to History. The match scoreboard shows each team's combined player‑pair name (e.g. *Ted & Dan*); long names wrap onto two balanced lines so the two scores stay aligned.
5. At the end, **Rematch** (same teams) or **Redraw** (same players, new teams).

For a smaller gathering, the Tournament tab also offers a **Best‑of Series** mode (4 players, 2 teams) — see below.

### Best‑of Series

When a full bracket is overkill, run a **best‑of‑N series** between two teams from the same Tournament tab:

1. Enter **4 player names**.
2. Form the two teams either by **random draw** (re‑drawable) or by **choosing partners** manually.
3. Pick a length — **Best of 3 / 5 / 7**.
4. Play games until one team wins the majority (2, 3, or 4). A live scoreboard shows the series score and a game‑by‑game list; the next game is one tap away.

Each game is a full scorepad played/resumed in‑app and archived to History, the most recent game can be undone, and **Rematch / Redraw** restart the series at the end. It runs on the same match‑play, locking, and Firebase sync machinery as the brackets (`format: "series"`), so a series syncs across devices through the same join‑code flow.

### Shared / multi-device tournaments

Tournaments can be **synced live across phones** via Firebase Realtime Database:

- Starting a tournament generates a short, friendly **6‑character join code** (e.g. `K7MXQ2`), shown with a tap‑to‑copy button.
- Other players join via **Tournament → Join with a code**.
- All match updates sync simultaneously across devices, **siloed per tournament**.
- Per‑match **locks** prevent two devices from editing the same game at once.
- Tournaments **auto‑expire after 48 hours** (enforced by Firebase security rules).
- The name book stays **local** to each device.
- **"Which player are you?"** — after starting or joining a synced tournament, tag yourself with your name from the roster (or set it later via **Playing as → Change** in the sync bar). Every match you're in then lands in *your own* History automatically as it's completed — even ones a teammate enters the score for — with no duplicate entries if you also played/recorded it yourself.

---

## Architecture

- **Single file.** Everything lives in `index.html` — markup, CSS in a `<style>` block, and the app in one IIFE `<script>`. No framework, no bundler, no transpile step.
- **Vanilla DOM rendering.** A small `el()` helper builds elements; a top‑level `render()` redraws the active view from a single `ui` state object plus the `game` / `gameHistory` / `tourney` data.
- **Offline‑first.** Solo games and history persist to `localStorage` and need no network.
- **Optional realtime backend.** Firebase Realtime Database (loaded from the gstatic CDN, compat build) powers shared tournaments only; if no config or network is present, the app still runs locally.
- **PWA shell.** iOS/Android standalone meta tags, an inline base64 app icon, and a felt‑table visual theme (Old Standard TT + IBM Plex Mono).

---

## Data & storage

Client state is kept under `localStorage` keys (all prefixed `somerset:dev-`):

| Key | Contents |
| --- | --- |
| `somerset:dev-v1` | The current solo game. |
| `somerset:dev-history` | Archived completed games. |
| `somerset:dev-tournament` | The active tournament (mirrored to Firebase when synced). |
| `somerset:dev-names` | Per‑device Quick‑add name book (max 60). |
| `somerset:dev-sync-code` / `somerset:dev-sync-role` | Current tournament join code and host/guest role. |
| `somerset:dev-device-id` | Random per‑device id used for match locks. |
| `somerset:dev-my-name` | Which roster name is "me" for the active join code, so tournament matches auto‑archive to History. |
| `somerset:dev-archived-matches` | Set of match ids already archived to this device's History, so auto‑sync never double‑adds one. |

In Firebase, tournaments are stored under `tournaments/<code>` with a `_createdAt` server timestamp. Security rules require a valid `format` (`single` / `double` / `round` / `series`) and a `teams` field, and make each record readable/writable only for 48 hours after creation. See [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md).

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

> Solo games and history work with no configuration. Shared tournaments require a Firebase Realtime Database — see below.

---

## Firebase setup

Shared, multi‑device tournaments need a Firebase Realtime Database. The full walkthrough — creating the project, enabling the database, pasting your `firebaseConfig`, and publishing the security rules — is in **[`FIREBASE_SETUP.md`](FIREBASE_SETUP.md)**.

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
├── index.html          # The entire application (HTML + CSS + JS)
├── FIREBASE_SETUP.md   # Step-by-step Firebase Realtime Database setup
├── ROADMAP.md          # Shipped features and future plans
├── README.md           # This file
├── package.json        # Dev-only (Playwright for bracket screenshot testing)
└── .vercelignore       # Excludes *.md from the Vercel deploy
```

---

## Roadmap

See [`ROADMAP.md`](ROADMAP.md) for the full list. Shipped highlights include the single‑game scorepad, game history, all three tournament formats, the **Best‑of Series** mode, and the shared multi‑device backend.

# Some-R-Set Scorepad — Design Review

*Reviewed 2026-07-01 against the live app (somerset-scorepad.vercel.app) at commit `1af4572`. Method: full click-through of every view/state in Chromium at phone viewport (22 screenshots), WCAG contrast math on the actual palette, CSS touch-target audit, and code walkthrough of every destructive/confirmation flow. Ordered by user-experience impact.*

**What's already strong:** the two-step deal entry (before/after the hand) with the set-warning shown *before* recording; the unsaved-result guard when leaving a match; End Tournament confirmation; auto-archiving finished games; the coherent vintage table aesthetic. Nothing below requires changing the app's character.

---

## 1. Deals can be deleted with one accidental tap — no confirm, no undo
Every deal row has an always-visible ✕ that is ~24×24px, sits inside a row that is itself tappable, and deletes instantly; on a finished game it also silently removes the game's History record. This is untake-backable data loss in the app's core loop, one stray thumb away during a lively game.
**Fix:** require the row to be expanded first (move ✕ into the deal-detail view), and show a 5-second "Deal removed — Undo" toast instead of a confirm dialog (undo beats confirmation for frequency-zero-cost recovery).

## 2. Brass text fails contrast exactly where the game state lives
Brass on cream is 3.47:1 (AA requires 4.5:1) and it's used at 11–13px for the dealer indicators (`Dealer ↓`), phase labels ("STEP 1 · BEFORE THE HAND"), history winners ("Ann & Bea won"), and MOON flags; tournament group headers are brass on shaded cream at 3.04:1. These are meaning-bearing labels read at arm's length on a game table, often in dim rooms.
**Fix:** add `--brass-text: #7A5E20` (≈5.4:1 on cream) and use it for all brass *text*; keep `#A07C2E` for fills, borders, and the large bold view-head/banner text (which legitimately passes at 3:1 large-text rules).

## 3. Pinch-zoom is disabled
The viewport meta includes `maximum-scale=1`, which blocks zooming on Android (WCAG 1.4.4 failure) — combined with the 11–13px serif labels above, low-vision players have no recourse.
**Fix:** delete `maximum-scale=1` from the meta tag. One-line change; double-tap-zoom side effects are negligible since inputs already use ≥16px font.

## 4. Frequent controls are far below minimum touch size
The trump-suit chips (used every single deal) are ~26px tall; text link-buttons (Back up/Restore, Edit, Change) are ~16px; sync-bar dismiss ✕ is ~24px; nav tabs ~34px. Apple/Material guidance is 44/48px, and this app is used mid-game with cards in hand.
**Fix:** give `.chip` ~10px vertical padding, `.link-btn` and `.del` a 44px min hit area (padding, not font size), and bump `.nav-btn` padding — all pure CSS, no layout redesign.

## 5. The "New Game" confirmation is two bare buttons with no question
Tapping the New Game link renders "Keep game / Yes, start fresh" at the very bottom of the page — below the fold on a long score sheet, detached from the link that triggered it, with no sentence explaining what's being asked or that the finished game is already saved.
**Fix:** use the existing modal-sheet pattern (like the seat menu) with copy: "Start a new game? This one is saved in History." — reusing `sheet-btn` styles already in the file.

## 6. Primary-button styling flips meaning between screens
On the Game tab the dark near-black button is the primary action ("Record Deal"); on Tournament screens dark buttons are secondary ("Best-of Series", "Re-draw teams", "Play in app") while brass is primary ("Set up 6 players", "Start …"). Visual weight stops predicting importance, so every new screen must be re-learned.
**Fix:** pick one grammar — brass = primary/GO, dark = neutral/secondary, red = destructive — and sweep all buttons once (`btn-new`/`btn-add`/`sheet-btn primary` usages).

## 7. "Start" buttons look enabled when they can't succeed
"Start series" renders full-strength brass with empty player names and silently does nothing on tap (its validation error is attached to "Draw teams" instead); disabled styling exists elsewhere (Draw teams greys out), so the inconsistency reads as a broken button.
**Fix:** drive the same `disabled` state from the shared validation (`recompute()`), or on invalid tap show the error message adjacent to the tapped button.

## 8. The app doesn't work offline — and can't be installed on Android
There's no manifest.json and no service worker; iOS home-screen meta exists, but a standalone launch with no connectivity shows a browser error page. A scorepad's natural habitat (kitchen tables, cottages, basements) is exactly where wifi is flaky, and everything except tournament sync is already client-side.
**Fix:** add a minimal web manifest plus a ~20-line cache-first service worker for the single HTML file; let Firebase sync stay online-only and surface "offline — sync paused" in the sync bar.

## 9. Nothing tells a new user that seats are tappable
A fresh game shows four "Seat 1–4" chips (in visual order 3/2/4/1, since numbering is clockwise from the bottom) with no hint that tapping opens name/dealer options — the earlier helper copy was removed. First-time users may score whole games as "Seat 1 beat Seat 3."
**Fix:** until any name is set or the first deal is recorded, show one italic line under the table: "Tap a seat to name players or change the dealer." (Removes itself; no permanent clutter.)

## 10. One tap can advance a tournament bracket
In the match sheet, "{Team} won" sits directly under "Play in app" at identical size, and when no game has been started it records the win and advances the bracket instantly with no confirmation. "Clear result" undo exists but only until the next round is played.
**Fix:** cheapest: visually demote the manual-win buttons (smaller, ghost style, under a "No app game? Record result" divider); or reuse the existing confirm sheet for the no-game case too.

## 11. Android back button exits the app
No history-API integration means hardware back from anywhere — mid-deal-entry, mid-match — leaves the site. localStorage persistence makes this recoverable, but it feels like a crash.
**Fix:** push one history state per "layer" (view, entry sheet, modal) and close the top layer on `popstate`; ~15 lines.

## 12. Silent failure gaps in feedback
Two related cases: (a) if localStorage writes fail, `ui.storageOk` is set false but never shown anywhere, so scores can silently stop persisting; (b) history game lines render as a run-on (`Ann & Bea 54 Cal & Dot 32`) that takes a beat to parse.
**Fix:** (a) render a small persistent warning bar when `!ui.storageOk` ("Scores aren't being saved on this device"); (b) format the line as "Ann & Bea **54 – 32** Cal & Dot".

## 13. Small polish items
- **"(bye)" looks like a team name** in brackets — style it italic/dimmed ("bye — advances automatically").
- **Step-2 bid summary looks editable** (bordered box) but isn't tappable — either flatten it to plain text or make tapping it go Back to step 1 (nice shortcut).
- **Modals are center-screen**; bottom sheets would be more thumb-reachable on phones and match the mobile idiom the app otherwise follows.
- **Zero-progress track is nearly invisible** (cream-shade on cream) — acceptable, but a hairline border would anchor it.

---

*Not re-litigated here: the multi-device sync concurrency issues (whole-object writes / lock TOCTOU) are already documented and deliberately deferred until core UX is solid — several fixes above (1, 4, 5, 7) are part of reaching that bar.*

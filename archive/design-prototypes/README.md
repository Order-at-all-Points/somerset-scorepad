# Design prototypes

Tooling for looking at SomeRSet's visual design without changing it. Everything
here reads `index.html`; nothing writes to it.

Nine experiments live here, at different stages:

| | Status |
| --- | --- |
| **Tactile masthead** (`build-masthead.js`) | **B · Letterpress shipped.** See the `h1` comment in `index.html`. The other five treatments are kept so the comparison can be re-run rather than rebuilt from memory. |
| **SCOREPAD subtitle** (`build-subhead.js`) | **Shipped:** `.26em` tracking, rules at 65% colour and 26px. See the `.subtitle` block. Both rejected ends of the ladder are kept — they are what make the shipped value legible as a choice. |
| **Scoreboard letterpress** (`build-press.js`) | **Shipped on the 48px `.score` only,** via `--press-lo`/`--press-hi`. Team names at 17px were tried and rejected — the impression stops registering at that size and only costs stem definition. |
| **The pad's edge on light felt** (`build-pad.js`) | **Shipped:** `--pad-edge`, a 1px ring at 2.5:1, per theme; the seam untouched. Fixes the light-theme finding below. Keeps the crisper 4.5:1 ring and the darkened seam — both measure better and were rejected on looking at them. |
| **What carries the label on a brass fill** (`build-brass.js`) | **Parked — decision recorded, nothing applied.** The 2.50:1 pairing ships. Both fixes were built, shipped and reverted; the generator holds all three states and the arithmetic showing there is no fourth. |
| **Row separator weight** (`build-rules.js`) | **Shipped:** `--rule-soft`, `--rule` mixed 60% toward the paper (1.44–1.55, was 1.14). Keeps the ladder either side, plus the conventional neutral-grey hairline at a matched weight — the one that looks wrong here. |
| **Raised-control bevel** (`build-button.js`) | **Shipped:** `--bevel-hi`/`--bevel-lo`, a 1px warm lip on the seven filled controls. Keeps the ladder either side — including the value that shipped for one commit and turned out to be invisible at phone scale. |
| **Vertical space** (`build-vertical.js`) | **Shipped:** `.empty-state` on the two zero-state boards, chip rows gated on the underlying set being empty. The original four options answered the wrong question — B/C/D are kept, and B is the one to render rather than read about. |
| **Depth on the seat tiles** (`build-seats.js`) | **Open — nothing applied.** The four `.seat` tiles are the flattest objects on the pad. Laddered on four axes — lift, inner edge, face texture, and the combinations — every variant styling `.seat` alone. Keeps three rows of the *earlier, wrong* question (a drawn surface under the seats) for the one finding they produced. |

The masthead presses text into the **felt**, which inverts between themes, so
`--mast-hi`/`--mast-lo` are per-theme. The scoreboard presses into the **pad**,
and `aubergine-light` is a token-for-token copy of `aubergine` apart from
`--felt`/`--felt-deep` and the `--mast-*` family — so `--cream` and `--ink` are
identical in both, and `--press-*` lives in `:root` as a single pair. The
asymmetry is deliberate; see the comment beside the tokens.

`--pad-edge` is the third case and goes **per-theme**: it draws the pad's edge
*against the felt*, so like `--mast-*` it has to flip with it. `--pad-seam` stays
in `:root` — it is the paper's own colour in every theme, and the fact that this
makes it invisible on light felt is the decision, not an oversight. Which side of
the split a token falls on is decided by what it contrasts against, not by what
it sits on.

Three of the audit findings turned out to be the same shape, and it is worth
recognising on sight: **one token doing two jobs, where only one job needs the
contrast.** `--felt-wash` tinting the felt vs. filling a badge on the pad;
`--brass` as an accent nothing sits on vs. as a ground under a cream label;
`--cream-shade` as a fill vs. as a 1px separator. Each looked like "this value is
too weak" and was really "this value is being asked for by something it was never
tuned for" — so each fix was a second token (`--brass-deep`, `--rule-soft`)
rather than a nudge to the first, which would have broken the job it was already
doing correctly. Before adjusting a token because one usage looks wrong, check
what else is asking for it.

The shape also shows up *forwards*, as a proposal rather than a bug, which is
easier to catch: `build-seats.js` row E3 paints `--felt` inside the pad to make
the seat diagram look like a card table. Same move — a token tuned as the ground
the paper sits **on**, asked to be a fill **in** it — and it takes the `--brass`
dealer tag and arrow down with it, since those were picked to sit on cream.
**A token borrowed across the pad/felt boundary drags everything already tuned
for the old ground.**

## Running

Playwright is a local dev dependency, and `package.json` is gitignored — so on
a fresh clone: `npm i -D playwright && npx playwright install chromium webkit`.
Run everything from the repo root.

```
node archive/design-prototypes/serve.js            # static server, reachable from a phone
node archive/design-prototypes/audit-contrast.js   # contrast audit, all themes
node archive/design-prototypes/measure-space.js    # dead space per screen per device
node archive/design-prototypes/screenshot-app.js   # full screenshot sweep -> out/screens/
node archive/design-prototypes/capture-screens.js  # real DOM -> out/screens.json
node archive/design-prototypes/build-masthead.js   # -> out/masthead.html
node archive/design-prototypes/build-subhead.js    # -> out/subhead.html
node archive/design-prototypes/build-press.js      # -> out/press.html
node archive/design-prototypes/build-pad.js        # -> out/pad.html
node archive/design-prototypes/build-brass.js      # -> out/brass.html
node archive/design-prototypes/build-rules.js      # -> out/rules.html
node archive/design-prototypes/build-button.js     # -> out/button.html
node archive/design-prototypes/build-vertical.js   # -> out/vertical-space.html  (needs capture first)
node archive/design-prototypes/build-seats.js      # -> out/seats.html           (needs capture first)
```

Where a generator has a shipped variant, that row renders whatever `index.html`
currently says rather than a copy of the values. The comparison stays honest as
the file moves, and a shipped row that suddenly looks wrong is a signal, not a
stale fixture.

`out/` is generated and gitignored. The generators are the artifact; the pages
are disposable and should be rebuilt against whatever `index.html` currently
says.

## serve.js

Binds `0.0.0.0` so a phone on the same Wi-Fi can reach it — that is the whole
reason it exists separately from `stress-test/server.js`, which is pinned to
`127.0.0.1` and resolves *any* file under the repo root including `.env.local`.
Fine on loopback; not something to put on a network. This one refuses every
dot-path and anything outside an extension allowlist, and only serves `.html`
from `out/`.

It reads live from the repo with `cache-control: no-store`, so edits appear on
refresh — deliberately the opposite of the harness's `snapshot()`, which freezes
a run against one revision.

Over plain HTTP on a LAN address: Add to Home Screen and standalone chrome both
work, and `viewport-fit=cover` means `env(safe-area-inset-*)` behaves. The
service worker will **not** register (not a secure context), so offline caching
is off; the app already swallows that failure. For a genuine PWA install you
need HTTPS — a Vercel preview deploy is the easy route.

## Why the prototypes use iframes

Each frame is an iframe at true device dimensions, so `100dvh`, `env()` insets
and media queries resolve exactly as on a phone. The vertical-space variant B
depends on this entirely — rendered in a scaled `<div>` it would silently
measure the desktop viewport and look like it worked.

`build-vertical.js` additionally scales frames with `transform: scale()` to fit
narrow screens. That is visual only: `iframe.contentWindow.innerWidth` still
reports the device width, so the layout under test stays honest.

## Traps already hit here

Worth knowing before extending any of this.

- **`APP.indexOf("<style>")` finds prose, not the element.** The early inline
  theme script has a comment reading *"Runs before `<style>` is parsed…"*, and
  that literal matches first. The slice then starts ~100KB early, mid-script,
  and the CSS parser discards everything up to the first selector it can resync
  on — which silently drops the **entire `:root` block**: the radius scale, the
  font stacks, `--plum`, `--press-*`. It went unnoticed for three experiments
  because the tokens they exercised (`--mast-*`) live in `[data-theme]` blocks,
  and an undefined `var(--font-display)` happens to fall back to a serif that
  looks close enough. The tell was a missing plum score bar. All generators now
  anchor on `/^<style>$/m` and **assert** the result contains `:root` — a wrong
  slice has to fail loudly rather than render a plausible lie.
- **`</script>` inside `index.html`'s CSS comments.** The stylesheet is embedded
  into a `<script>` block as a JSON string; without escaping `<` as `<`,
  the HTML parser terminates the block early and the page silently renders
  nothing. Both generators use a `js()` helper for this.
- **`isMobile`/`hasTouch` in Playwright contexts.** They synthesise both touch
  and mouse events for one `click()`, which double-fires the `+`/`−` steppers
  and corrupts every bid. Use a phone-sized viewport without the emulation.
- **Bids are 6..14** (`POINTS_PER_DEAL`). Lower values are clamped and the
  stepper silently refuses to move — it looks like a hang, not a rejection.
- **Step 2 of hand entry submits with "Record Take"**, not "Record deal".
  `handEntry.submitDeal()` is for the edit flow only.
- **Flexing `body` breaks `.wrap`.** `.wrap` carries `margin: 0 auto`, and auto
  margins in the cross axis absorb free space, which disables
  `align-items: stretch`. Without an explicit `width: 100%` the wrap collapses
  to its content width and the whole app narrows. Cost an hour in
  `build-vertical.js`.
- **A zoomed comparison lies about 1px effects.** `build-button.js` frames are
  390px wide and unscaled for this reason. A 1px bevel separates convincingly at
  3× and can be completely imperceptible on the phone it ships to — the first
  bevel value was picked from a zoomed render and was a no-op in the app. Any
  hairline (bevels, rings, seams, separators) has to be judged at true device
  scale, which is also why `screenshot-app.js` renders at 390×844 rather than
  something roomier.
- **A prototype page needs its own `<!doctype>` and viewport meta.** Without
  them iOS lays out at 980px in quirks mode and the page is unusable on the
  device it is describing.
- **Screenshots are not deterministic unless you disable `.fade`.** The 350ms
  entry animation lands mid-flight, so hashing two shots of the *same* file
  gives two different answers — which makes a before/after diff look like a
  change everywhere and prove nothing. `newContext({ reducedMotion: "reduce" })`
  hits the `prefers-reduced-motion` rule the app already honours; with it, the
  same file twice hashes identically and a real diff stands out.
- **`serve.js` refuses dot-paths, including your scratch baseline.** Writing a
  `git show HEAD:index.html` comparison copy to `.before.html` gets a refusal,
  and a screenshot of the error page hashes the same for every theme — which
  reads as "nothing changed" rather than "nothing loaded". Give baselines an
  ordinary name.
- **A two-theme grid can be a no-op by construction.** `aubergine` and
  `aubergine-light` differ only in `--felt`/`--felt-deep`, `--mast-*`,
  `--felt-wash*` and `--pad-edge`. `--cream`, `--cream-shade`, `--rule`, `--ink`,
  `--ink-soft`, `--control` and `--seat-rule` are byte-identical. So anything
  living entirely **on the pad** renders the same in both, and a side-by-side
  proves nothing unless a variant reaches for a felt token — which is exactly
  what makes it worth keeping: in `build-seats.js` the only row whose two columns
  differ is the only row doing something wrong. Check which side of the boundary
  an experiment sits on before assuming the toggle is telling you anything.
- **`.seat.dealer` owns its own `box-shadow`.** It carries
  `inset 0 0 0 2px var(--brass)` for the dealer ring, so any depth added to
  `.seat` is silently dropped on the one tile the eye goes to first — and the
  diagram ends up with three deep tiles and one flat one. Every variant in
  `build-seats.js` restates the dealer. Same trap anywhere a state class
  re-declares a shorthand.
- **`color-mix()` computes to `color(srgb …)`, not `rgb()`.** Channels come back
  as 0–1 floats in a different function name, so a parser that only matches
  `rgba?\(` returns null on exactly the tokens that use it (the dark themes'
  `--pad-seam`). `audit-contrast.js` handles both forms.

## Findings these produced

`audit-contrast.js` output, for reference. Only the pad one is fixed:

- ~~In `aubergine-light` the pad measures **1.13:1** against the felt and the
  `.pad` dashed outline **1.05:1** — the cream-paper-on-felt metaphor does not
  render in the shipped Light theme.~~ **Fixed** via `--pad-edge`; see
  `build-pad.js`. Both light themes were affected, not just the shipped one,
  since they share `--felt`.
  The pad-vs-felt line still reads 1.13 and always will — neither tone could
  move — and the seam's 1.05 is now deliberate too, so **neither number is the
  check any more**. The audit asserts the thing that actually matters instead:
  *exactly one* of ring/seam carries the edge on a given ground (seam on dark,
  ring on light), and the row that can fail is the pair being absent. Scoring
  them independently just reports INVISIBLE on whichever one is meant to be.
- ~~`--felt-wash` measures 1.01–1.12 against felt in **every** theme, so inactive
  nav tabs and the OPTIONS pill have no fill anywhere in the app.~~ **Half wrong,
  and now fixed.** Only `aubergine-light` was actually broken: it inherited the
  dark themes' *white* wash verbatim (`rgba(255,255,255,.04)`), which on light
  felt lightens toward the pad's cream — the exact opposite of recessing a
  control — and measured 1.01:1, so the inactive tabs had no fill and the active
  one stopped reading as selected. It now uses Classic Light's black values.
  The other three themes were fine all along at 1.11–1.12: a 132×44 filled tab
  with its own border reads clearly at that ratio, which the 1.25 flag was never
  meant to judge. `audit-contrast.js` now scores those two rows as tints against
  a 1.04 floor, so a real disappearance still trips it. **Reading a flag as a
  finding without looking at the screen is what merged this with the pad
  problem, where 1.13 genuinely was the whole boundary.**
- `--cream` on `--brass` is **2.50:1** in the live themes — every filled brass
  control (`.btn-record`, `.btn-new`, `.chip.on`, `.hist-win-badge`) is below AA.
  **Reviewed 2026-07-29 and kept**, on the judgement that it reads fine in the
  hand. Not an open finding, and please read `build-brass.js` before touching it
  — it has been fixed twice and reverted twice:
  - *Keep the light label, darken the ground* — measures 5.02, and turns
    `.btn-record`, the primary GO control, a dark olive that stops out-weighing
    `.btn-add` beside it.
  - *Keep the gold, move the label* — measures 5.19, and the label has to go to
    near-black.
  There is **no third option**. `--brass` sits at luminance .314; a cream label
  at 4.5:1 forces its ground below .152, and on that gold a passing label needs
  luminance ≤ .031. Either the button stops being gold or the label stops being
  light. The audit still prints the number, marked `soft` with the review date,
  so a change to `--brass` or `--cream` still moves it.
- ~~**The two zero-state boards render filter chrome around a one-line
  caption.**~~ **Fixed.** `History` and `Stats` on first run both showed the
  Log/Stats switcher and a full chip row — `All / Today / Standard / Tournament`,
  or the four sort chips — filtering over a set with no members, above `.empty`
  at its 20px padding. History-empty is the literal first screen a new user sees.
  Both now render `.empty-state`, and the chip rows are gated on the underlying
  set being empty (`!gameHistory.length`), **not** on the rendered result being
  empty — "No games match this filter" keeps its chips deliberately, or the
  filter that hid everything is also the one you can no longer change.
  `.empty` keeps its 20px and its four remaining callers: that padding is right
  for a caption under a populated list and wrong when the caption *is* the
  screen, which is the distinction the new class exists to draw.

  Worth reading `measure-space.js` output against this one, because the two
  disagree and the measurement loses. It flags any screen whose void grows from
  SE to Pro Max, which is all five short screens — and only two of them are
  broken. `Tournament — setup` is a complete card (heading, stepper, primary
  action, secondary route out); `Stats — 4 players` has four rows because there
  are four players; `History — 1 game` grows on its own. Felt under a finished
  card is the metaphor working: the pad is paper on a card table, so the table
  showing is the point. Variant `B` stretches all of them to `100dvh` and rules
  the remainder, which under the tournament form reads as an unfinished page and
  under the rank list reads as ranks 5–12 existing and being blank. **"Which
  screens are short?" is not "which screens look unfinished?", and dead space is
  a bad proxy for either.** The generator now renders both zero-state boards so
  the two groups sit in the same comparison, and `A · Current` renders the
  shipped fix from `index.html` rather than a copy of it — recapture before
  judging, or `A` shows you the app as it was.

- ~~`--cream-shade` on `--cream` is **1.14:1**, so every row separator in the app
  is invisible.~~ **Fixed.** Third instance of the same shape as the two above:
  one token doing two jobs, and only one of them needing the contrast. As a
  *fill* 1.14 is correct and stays — pressed states, disabled buttons, the
  score-bar track, the pending deal row, `.stats-hero-champ` (which moved onto it
  from `--felt-wash-strong`, a felt token being painted on the pad). The 15
  separator sites moved to `--rule-soft`. See `build-rules.js` for why the weight
  was bounded on both sides rather than chosen.

## Noted, not acted on

Things measured and written down without a generator or a fix. Reviewed
2026-07-29.

- **The dotted "tap me" underline is dense enough on the stats sheet that it
  stops carrying information.** One player's sheet renders **16** of them —
  11 `.stats-tile-label`, 4 `.stats-pair-label`, 1 `.stats-section-title` — against
  4 comparable labels with none. All 16 mean the same thing (*tapping this opens
  an explanation*) and all 16 are already `role="button"` with an `aria-label`, so
  the underline is carrying no accessibility load.

  The useful part is *where* it discriminates, since a marker only informs when
  some siblings lack it:

  | Group | Tappable | Underline does |
  | --- | --- | --- |
  | Tile grids | 11 of 11 | nothing — it's a property of "tile" |
  | Pair rows | 4 of 4 | nothing — same |
  | Section titles | **1 of 5** | real work: `Games by month` opens, `Recent form` doesn't |

  So the treatment earns its place in the one group where it is rarest and is
  ornament in the two where it is dense — the inverse of what you want. There is
  also a third implementation of the same signal: `.peer-follow-btn` uses
  `text-decoration:underline dotted` rather than a `border-bottom` (Stats Sharing
  sheet, so not among the 16).

  **Do not just delete the 15.** The `:active` background only appears once you
  are already pressing, so the underline is the only at-rest cue that the tiles
  explain themselves at all — subtracting it removes discoverability along with
  the noise. The real question is whether 11 tiles that behave identically want 11
  markers or one statement, which wants a prototype rather than an edit. Cheapest
  honest version if it comes up: keep it on section titles, drop it from the two
  uniform groups, add one line under the first grid saying the tiles explain
  themselves.

  Counted by computed style on a real two-game sheet, not by reading the CSS —
  `.stats-tile[role="button"]` and friends are conditional on an `explain` string
  being passed, so grepping the stylesheet tells you the rule exists, not how many
  elements match it.

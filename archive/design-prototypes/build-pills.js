"use strict";
/**
 * Should the selected filter pill be raised like the bidder tile? -> out/pills.html
 *
 * `.stat-sort-chip.on` -- the active pill in the History log's filter row and the
 * Stats sheet's sort row -- carried `box-shadow:none` when this page was built. Not a
 * lighter treatment than the other filled controls: none at all. Measured as found:
 *
 *   .who button.on   (bidder)   179x44px  radius   8px  bevel + 0 1px 2px/.25
 *   .chip.on         (setting)   89x42px  radius 999px  bevel + 0 1px 2px/.25
 *   .stat-sort-chip.on (filter)  61x32px  radius 999px  NONE
 *
 * Seven rules carried --bevel-hi at that point. `.stat-sort-chip.on` was the eighth
 * filled, pressable, free-standing control and the only one with no depth of any
 * kind. The other cream-on-fill rules without a bevel are all correctly excluded:
 * badges you do not press (.hist-win-badge, .mbox-slot.win, .stats-form-pill), table
 * headers, and the swipe-revealed .deal-detail-btn/.swipe-action-btn, which sit UNDER
 * a row rather than on top of it.
 *
 * That count is what made this look like a consistency gap. It was not one -- read the
 * SETTLED section before reusing the argument. The pill still carries no depth at all,
 * so the seven-vs-one framing above is how the question ARRIVED, not how it resolved.
 * (This sentence said "the pill now carries the lip and not the lift" for one commit,
 * left behind by the B1 retreat after B1 was itself dropped. It flatly contradicted
 * the REJECTED note sixty lines down. Kept as a marker: a generator that preserves
 * rejected options has to be re-read END TO END after a reversal, because the stale
 * line is never in the section you are editing.)
 *
 * TWO OBJECTIONS, ONE OF WHICH IS ALREADY DEAD. The first was geometry: a 1px inner
 * lip on a fully-rounded shape should read as gloss rather than as a lip, which is
 * the exact failure the --bevel-* comment warns about past ~45%. That objection does
 * not survive the file -- `.chip.on` is --r-pill, radius 999px, and has shipped the
 * identical three-layer shadow since fa01439. The radius is proven.
 *
 * The second objection is live and is the real question here: SIZE, and what the row
 * is. The bevel's useful range was found at 44px controls, and build-button.js keeps
 * 22/18 as a documented no-op at that size. This pill is 32px -- a third shorter --
 * so the same alphas cover proportionally more of it. "Too light at 44px" does not
 * transfer, in either direction, which is why the lower bound is re-asked in B5
 * rather than assumed settled.
 *
 * THE ROW IS AN AXIS OF ITS OWN, NOT A WEIGHT. `.chip` and `.who button` are already
 * objects AT REST -- a --control fill plus 0 1px 2px/.1 -- so selecting one raises
 * something already raised. `.stat-sort-chip` at rest is `background:none` with no
 * shadow: an outline drawn on the paper. Group B changes only the selected pill and
 * leaves its four siblings as outlines; group C raises the whole row into structural
 * parity with the .chips row, and risks turning filter chrome you are meant to look
 * past into five pieces of furniture on the stats sheet. Not weights of one idea --
 * different claims about what the row is. C lost; see SETTLED.
 *
 * A COMPANION RULE IS REQUIRED, and it is not optional dressing. There was no
 * `.stat-sort-chip.on:active` in the app before this work -- correct while the pill
 * was flat, since re-tapping the active filter is a no-op and there was nothing to
 * drop. It ships alongside the lip.
 * Every beveled control does set `box-shadow:none` on :active (the --bevel-* comment
 * relies on exactly this: "which drops the bevel with the lift"), and both pill-shaped
 * precedents also scale: `.chip.on:active` and `.who button.on:active`. So every
 * variant below that adds depth also emits `transform:scale(.96); box-shadow:none`
 * on `.on:active`. Ship the depth without it and the selected pill is the one raised
 * control in the app that stays raised when pressed.
 *
 * BOTH THEME COLUMNS DIFFER HERE, unlike seats.html where everything inside the pad
 * rendered identically. 962ac26 gave aubergine-light `--plum:var(--ink)` while dark
 * keeps :root's #2E1B3A, so the fill under this bevel is warm near-black on light and
 * purple on dark. Check the lip on both: --bevel-lo is mixed from --ink, and it has
 * more to bite into on a warm fill than on a purple one.
 *
 * (That same commit is why the question came up. It made this pill's fill byte-
 * identical to the bidder tile's ON LIGHT -- both resolved to --ink, rgb(44,38,32) --
 * so two controls shared a fill while one was raised and one was flat. The
 * inconsistency predates the change; the change is what made it visible.
 * They now share a fill in EVERY theme, and from the other direction: on 2026-07-29
 * .who button.on moved to --plum, so the tile followed the pill rather than the pill
 * following the tile. See the coda at the bottom -- it is the same two controls and
 * the opposite answer, and the difference between the two is worth understanding
 * before touching either.)
 *
 * JUDGE AT TRUE DEVICE SCALE. Frames are 390px and unscaled. These are 1px effects
 * on a 32px control and a zoomed frame is precisely what lies about those -- the
 * app's first bevel value shipped from a zoomed render and did nothing in the hand.
 *
 * REJECTED -- NOTHING APPLIED. The pill still carries no box-shadow, and A1 renders
 * live from index.html so this page keeps telling the truth about that.
 *
 * TWO ATTEMPTS, BOTH TURNED DOWN, AND THE SECOND ONE IS THE FINDING. B3 (full
 * parity, the exact three-layer stack the other seven controls carry) shipped to a
 * preview and came back off. B1 (the same lip with the lift removed, so the pill
 * gains an edge without standing up) was the retreat, and it was rejected for the
 * same reason: it takes something away from the bidder tiles.
 *
 * SO WEIGHT WAS NEVER THE VARIABLE. One rejection could have meant "too heavy" and
 * would have left a ladder to walk down -- B4, B5, a lighter pair. Two rejections at
 * two different weights, for one reason, says the axis itself is spoken for. There is
 * no quieter version of joining a set; you are either in it or not. Any depth on this
 * pill spends something that belongs to .who button.on, so the fill does the work
 * alone, which it was already doing.
 *
 * WHAT WENT WRONG WAS THE MEASUREMENT, NOT THE VALUE. The gap was found by counting:
 * seven filled pressable controls carry --bevel-*, one does not, so the one is
 * inconsistent. That is only a finding if the seven are the real set. They are not a
 * list of filled controls, they are the controls that ACT -- record, add, delete,
 * confirm, commit a setting -- and the treatment reads as meaning that partly BECAUSE
 * few things wear it. A view filter changes what you are looking at. The pill was
 * never the odd one out; it was on the correct side of a line.
 *
 * index.html already said so, about the fill, in the comment directly above the rule:
 * "brass marks a SETTING you've committed to ... whereas these only change what
 * you're looking at". That was read, quoted into the analysis, and argued past on the
 * grounds that colour carried the distinction and depth did not. It carried on both.
 * WHEN THE FILE ALREADY ARGUES AGAINST THE CHANGE, THAT IS EVIDENCE, NOT CONTEXT.
 *
 * The first report was "the bidder buttons changed" -- and they had not, provably:
 * all six .who rules text-identical to main, both states computing identically in
 * both themes, the only computed difference on the branch being the pill's own
 * box-shadow. What changed was that they stopped being one of the few things wearing
 * the treatment. A diff cannot show that, and neither can any single frame on this
 * page: every variant below looks defensible in isolation. That is the trap this
 * generator exists to record.
 *
 * Two more things the rendering decided that the argument could not.
 *
 * Group C lost, and it was the genuinely open question going in. Raising the row
 * means giving unselected pills a --control fill, which is LIGHTER than the sheet:
 * the whole strip brightens and reads as five buttons competing with the rank rows
 * below. Structurally faithful to the .chips row, wrong for chrome you look past.
 *
 * And 22/18 IS NOT A NO-OP AT 32px. build-button.js records it as imperceptible,
 * which it was -- on the 42-44px controls it was measured on. B5 against B2 (lift,
 * no lip) shows a faint but real top edge here. So the bevel's "narrow useful
 * range" is per size, and its floor drops as the control shrinks, because the same
 * 1px lip is a larger share of a shorter edge. Recorded in index.html's --bevel-*
 * note as well, since that is where the range is asserted. It did not change the
 * outcome -- 32px took the shipped pair unmodified with room before the key-cap end
 * -- which is the argument for using --bevel-* as it stands rather than B4/B5: a
 * lighter pair would be a new value to name and defend for no gain.
 *
 * B6 does not earn its weight. A pill in a scrolling row seemed like it might want
 * .seat's two-layer card shadow rather than the button lift; it renders fine, softer
 * and more spread. But d389923 justified that treatment by the tile REPRESENTING a
 * physical card. A filter pill is a control, not an object, so the button vocabulary
 * is the one it belongs to.
 *
 * CODA, 2026-07-29: THE SAME PAIR, THE OTHER DIRECTION, AND IT WAS FINE.
 * Hours after this was dropped, .who button.on took the pill's FILL -- --plum,
 * replacing --ink -- so on dark the selected bidder tile is now the same purple as
 * the active filter pill, which is aubergine dark's --felt: a window through the pad
 * to the table. Nothing here was reopened and no depth moved.
 *
 * That is not a reversal, and the difference is the whole lesson of this file. What
 * was rejected twice above was giving the pill the BEVEL -- a treatment whose meaning
 * comes from being scarce, so extending it spends it. A fill is not scarce. --plum
 * was already on the score bar and the pill; a third user does not dilute anything,
 * because nothing was reading "plum therefore filter" the way something reads "raised
 * therefore acts". Colour here says WEIGHT (the deepest tone the palette carries cream
 * on); depth says ROLE. Sharing a weight is free. Sharing a role is not.
 * Which also means the seven-vs-one count above is untouched: the tile did not join
 * or leave the bevel set, and the pill still has no depth.
 *
 * Two things fell out of doing it that belong here rather than in index.html.
 *
 * A TOKEN SWAP WAS THE WHOLE CHANGE, because --plum is overridden per theme and
 * already means "deepest tone that carries cream". So one edit landed the purple on
 * aubergine, landed Classic Dark's own --felt-deep wine on Classic Dark, and was a
 * BYTE-IDENTICAL NO-OP on both light themes, where --plum is already var(--ink).
 * Verified by walking every element in the Step-1 tree on main and on the branch and
 * comparing six computed paint properties: 1 of 90 elements differs on aubergine, 1
 * of 90 on Classic Dark, 0 of 90 on both light themes. Worth the ten minutes -- "it
 * only affects dark" was a claim about four theme blocks and one :root fallback, and
 * this session had already been wrong once about which themes a plum change reaches.
 *
 * AND --bevel-lo HAS NEVER DONE ANYTHING ON AN --ink FILL. It is --ink at 26%, so
 * over a fill of --ink it composites to --ink: 1.00:1, the pair collapsed to its
 * highlight. .who button.on was in that state in every theme until the swap, which
 * means the bevel comparisons in the variants below were against a tile whose lower
 * lip was already absent. .btn-add still is. Nothing was changed for it -- the lip is
 * invisible at this alpha either way -- but if you ever tune --bevel-lo, note that
 * two of the seven controls were never showing it, and index.html's --bevel-* comment
 * now says so.
 *
 *   node archive/design-prototypes/capture-screens.js   # first, once
 *   node archive/design-prototypes/build-pills.js
 *   node archive/design-prototypes/serve.js             # open /pills.html
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const SRC = path.join(OUT, "screens.json");
const DEST = path.join(OUT, "pills.html");

if (!fs.existsSync(SRC)) {
  console.error("Missing " + SRC + "\nRun: node archive/design-prototypes/capture-screens.js");
  process.exit(1);
}

const APP = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
/* Anchor on the <style> tag alone on its own line; a plain indexOf() matches the
   words "<style>" in an earlier comment and silently drops :root. See the README. */
const STYLE_AT = APP.search(/^<style>$/m);
if (STYLE_AT < 0) throw new Error("no <style> element found in index.html");
const CSS = APP.slice(STYLE_AT + 7, APP.indexOf("</style>", STYLE_AT));
if (!/:root\s*\{/.test(CSS)) throw new Error("extracted CSS has no :root block");

const SCREENS = JSON.parse(fs.readFileSync(SRC, "utf8"));

/* Both rows that use this class, because the treatment lands on both and they sit in
   different company: the Stats sort row has rank rows with their own gold progress
   bars under it, the log's filter row has date headers and game cards. A pill weight
   that reads as trim on one can read as a second row of buttons on the other. */
const SCREEN_KEYS = ["stats-list", "history-one"];
for (const k of SCREEN_KEYS) {
  if (!SCREENS[k]) {
    console.error("screens.json has no '" + k + "' entry.\n" +
                  "Rerun: node archive/design-prototypes/capture-screens.js");
    process.exit(1);
  }
  if (!/stat-sort-chip/.test(SCREENS[k].html)) {
    console.error("'" + k + "' has no .stat-sort-chip in it -- the row only renders once " +
                  "there is data to filter, so this capture is from an empty state.\n" +
                  "Rerun: node archive/design-prototypes/capture-screens.js");
    process.exit(1);
  }
}

/* How far off the paper. The app's existing vocabulary: /.1 is what a control casts
   AT REST (.chip, .who button, .step), /.25 is the raised-fill signature the seven
   raised controls carry when active, and it is the layer B1 deliberately omits --
   see the header. `card` is the two-layer treatment d389923 gave .seat, a thin
   object lying on paper rather than a button standing on it, which seemed like it
   might be what a pill in a scrolling row is. It is not; see B6. */
const LIFT = {
  rest: "0 1px 2px rgba(0,0,0,.1)",
  soft: "0 1px 2px rgba(0,0,0,.18)",
  fill: "0 1px 2px rgba(0,0,0,.25)",
  card: "0 1px 1px rgba(0,0,0,.14), 0 3px 8px rgba(0,0,0,.10)",
};

/* Inner edges. `ship` is the live token pair, unchanged, so B3 is literally "what
   .chip.on has". The others are written out longhand rather than through the tokens
   on purpose: --bevel-hi/--bevel-lo are tuned for 44px controls and this is a 32px
   one, so any different weight here would be a NEW pair to justify and name, not a
   tweak. Seeing them longhand keeps that cost visible. */
const bevel = (hi, lo) =>
  `inset 0 1px 0 color-mix(in srgb, var(--cream) ${hi}%, transparent), ` +
  `inset 0 -1px 0 color-mix(in srgb, var(--ink) ${lo}%, transparent)`;
const EDGE = {
  /* The live token pair. B1 ships this ALONE; the seven raised controls ship it
     stacked over LIFT.fill, which is what B3 restores. */
  ship: "inset 0 1px 0 var(--bevel-hi), inset 0 -1px 0 var(--bevel-lo)",
  /* build-button.js's documented lower bound: a no-op at 44px, kept in that file for
     the reason it is re-asked here -- a value that does nothing still looks like a
     decision in the diff. At 32px the same alphas cover more of the control. */
  light: bevel(22, 18),
  hiOnly: "inset 0 1px 0 var(--bevel-hi)",
  /* Past the ~45% ceiling the --bevel-* comment names. Here so B3 reads as a choice
     rather than as a number, and to show the key-cap failure at pill radius. */
  gloss: bevel(48, 40),
};

/* Emits the selected pill, the :active companion the app's convention requires, and
   optionally the at-rest row. The .on:active rule ships now (it did not before this
   generator), so variants restate it rather than introduce it. */
function pill(o) {
  const layers = [o.inset, o.lift].filter(Boolean).join(", ");
  let css = `.stat-sort-chip.on{box-shadow:${layers};}`;
  if (o.row) {
    /* Raises the ROW, not the pill: the unselected chip becomes an object at rest,
       which is what .chip and .who button already are. Its own :active already sets
       a --cream-shade fill and a scale, but no box-shadow:none, because there was no
       shadow to drop until now. */
    css += `.stat-sort-chip{background:var(--control);box-shadow:${LIFT.rest};}` +
           `.stat-sort-chip:active:not(.on){box-shadow:none;}`;
  }
  css += `.stat-sort-chip.on:active{transform:scale(.96);box-shadow:none;}`;
  return css;
}

const GA = "A - Where it stands today";
const GB = "B - The PILL only: siblings stay flat outlines. How far off the paper should the selected one come, if at all?";
const GC = "C - The ROW: unselected pills become objects at rest too, as .chip and .who button already are";
const GD = "D - Bounds, kept";

const VARIANTS = [
  /* WHAT SHIPS, and it is what shipped before any of this. Empty css so the row
     renders whatever index.html currently says rather than a copy that can rot --
     same convention as build-button.js and build-seats.js. */
  { g: GA, t: "A1 - SHIPPED (unchanged): box-shadow:none. The only filled pressable control in the app with no depth, and after two attempts, deliberately so. Renders live from index.html",
    css: `` },

  /* ALSO REJECTED, and the row that makes the page worth keeping. B1 was the
     retreat from B3 -- same lip, lift removed, so the pill stops standing up and
     merely gains an edge. It was rejected for the SAME reason B3 was, which is
     what settles the question: weight is not the variable. */
  { g: GB, t: "B1 - REJECTED: the lip with NO lift -- an edge on the fill, flush with the paper, not an object. Built as the retreat from B3 and turned down for the same reason: it still takes something from the bidder tiles. Two rejections at different weights is what makes this a question of KIND, not degree",
    css: pill({ inset: EDGE.ship }) },
  { g: GB, t: "B2 - Lift only, no lip: the mirror image of B1, and the pair worth comparing first -- B1 has the lip and no lift, this has the lift and no lip. One reads as an edge on the paper, the other as an object above it",
    css: pill({ lift: LIFT.fill }) },
  /* SHIPPED, THEN REJECTED -- the important row on this page. Kept explicit rather
     than empty, because it is no longer what index.html says and the whole reason
     it lost is invisible unless you can put it beside B1. See the header. */
  { g: GB, t: "B3 - REJECTED: full parity, the exact three-layer stack .chip.on and .who button.on carry. Shipped to a preview and taken back off -- it looks right in isolation and dilutes what the lift MEANS. Compare with B1 above, which is what ships",
    css: pill({ inset: EDGE.ship, lift: LIFT.fill }) },
  { g: GB, t: "B4 - Shipped lip, softer lift (/.18): same idea as B3 sized for a 32px control rather than a 44px one",
    css: pill({ inset: EDGE.ship, lift: LIFT.soft }) },
  { g: GB, t: "B5 - Lighter lip (22/18), full lift: build-button.js's documented no-op weight, re-asked at two thirds the height  (if this reads, the smaller control genuinely wants less)",
    css: pill({ inset: EDGE.light, lift: LIFT.fill }) },
  { g: GB, t: "B6 - Card shadow instead of the button lift: the two-layer treatment d389923 gave .seat, on the theory that a pill in a scrolling row is a thin object lying on the sheet rather than a button standing on it",
    css: pill({ inset: EDGE.ship, lift: LIFT.card }) },

  { g: GC, t: "C1 - Row raised + full parity on the selected pill: structurally identical to how the .chips row behaves  (watch the row become furniture rather than trim)",
    css: pill({ inset: EDGE.ship, lift: LIFT.fill, row: true }) },
  { g: GC, t: "C2 - Row raised + softer lift on the selected pill: the same, with less distance between at-rest and selected",
    css: pill({ inset: EDGE.ship, lift: LIFT.soft, row: true }) },

  { g: GD, t: "D1 - Lip at 48/40: past the ~45% ceiling the --bevel-* note names. The key-cap failure at pill radius, kept so B1's lip weight is legible as a choice rather than as a number",
    css: pill({ inset: EDGE.gloss, lift: LIFT.fill }) },
  { g: GD, t: "D2 - Highlight only + full lift: no dark lower lip. The near-white-on-cream carve-out fa01439 made does NOT apply here (this fill is near-black), so this row is about the pill's own curve, not about grubbiness",
    css: pill({ inset: EDGE.hiOnly, lift: LIFT.fill }) },
];

const THEMES = [
  { k: "aubergine", l: "Dark  (fill is :root's #2E1B3A)" },
  { k: "aubergine-light", l: "Light  (fill is --ink since 962ac26 -- the lip has a warm ground here, a purple one on the left)" },
];

/* index.html's CSS comments contain "</scr"+"ipt>", which would terminate the
   embedding block. Escaping "<" is the standard mitigation. */
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003C");

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SomeRSet &mdash; should the filter pill be raised?  (no &mdash; twice)</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box} html,body{margin:0}
  body{font:15px/1.5 -apple-system,system-ui,sans-serif;background:#121016;color:#EDE6DA;
       padding:0 0 60px;-webkit-text-size-adjust:100%}
  .pagepad{padding:20px max(16px,env(safe-area-inset-left)) 0}
  h1.pt{font-size:19px;margin:0 0 8px;font-weight:650}
  .lede{margin:0 0 8px;color:#A79C8D;font-size:14px;max-width:74ch}
  .lede code{color:#D8CDB9}
  .lede strong{color:#EDE6DA}
  table.meas{border-collapse:collapse;margin:10px 0 14px;font-size:13px;color:#A79C8D}
  table.meas td,table.meas th{padding:3px 14px 3px 0;text-align:left;font-weight:400;white-space:nowrap}
  table.meas th{color:#8E8476;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  table.meas .no{color:#E8B0A0}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8E8476;
     margin:30px 0 0;padding:18px max(16px,env(safe-area-inset-left)) 0;border-top:1px solid #2A2532}
  .row{padding:14px max(16px,env(safe-area-inset-left)) 0}
  .cap{margin:0 0 8px;font-size:13px;font-weight:600;color:#F3ECDF;max-width:74ch}
  .pair{display:flex;gap:14px;flex-wrap:wrap}
  .panel{flex:0 0 390px;max-width:100%;min-width:0}
  .panel .lbl{font-size:11px;color:#8E8476;margin:0 0 4px}
  /* 390px and unscaled: these are 1px effects on a 32px control, and a zoomed frame
     is exactly what lies about those. See the README. */
  .panel iframe{width:100%;height:330px;border:0;display:block;border-radius:9px;border:1px solid #332D3D}
  .foot{margin-top:44px;color:#8E8476;font-size:13px;border-top:1px solid #2A2532;
        padding:18px max(16px,env(safe-area-inset-left)) 0;max-width:80ch}
  .foot code{background:#1E1A26;padding:1px 5px;border-radius:4px;font-size:12px}
  @media(max-width:560px){.lede{font-size:13px}}
</style></head><body>
<div class="pagepad">
  <h1 class="pt">Should the selected filter pill be raised like the bidder tile?</h1>
  <p class="lede">Real captured DOM (<code>stats-list</code> and <code>history-one</code>) under the app's real CSS. Every variant styles <code>.stat-sort-chip</code> and nothing else.</p>
  <table class="meas">
    <tr><th>control</th><th>size</th><th>radius</th><th>selected-state depth</th></tr>
    <tr><td><code>.who button.on</code> &mdash; bidder</td><td>179&times;44</td><td>8px</td><td>bevel + 0 1px 2px/.25</td></tr>
    <tr><td><code>.chip.on</code> &mdash; a setting</td><td>89&times;42</td><td>999px</td><td>bevel + 0 1px 2px/.25</td></tr>
    <tr><td><code>.stat-sort-chip.on</code> &mdash; a filter, <strong>then and now</strong></td><td>61&times;32</td><td>999px</td><td class="no">none</td></tr>
  </table>
  <p class="lede"><strong>Answered: no &mdash; and nothing shipped.</strong> Full parity (<strong>B3</strong>) went to a preview and came back off. <strong>B1</strong>, the same lip with the lift removed, was the retreat and was turned down for the same reason: it still takes something away from the bidder tiles. <em>Two rejections at two different weights, for one reason, means the axis is spoken for rather than the value being too strong.</em> There is no quieter way to join a set. The pill keeps doing its work with fill alone.</p>
  <p class="lede"><strong>Every frame below looks defensible in isolation</strong>, which is the trap this page records. The gap was found by counting &mdash; seven filled controls carry the bevel, one does not &mdash; and that is only a finding if the seven are the real set. They are not "filled controls"; they are the controls that <em>act</em>. The treatment means that partly <em>because</em> few things wear it.</p>
  <p class="lede"><strong>The radius objection is dead.</strong> <code>.chip.on</code> is <code>--r-pill</code> at radius 999px and has carried the identical bevel since <code>fa01439</code>, so a 1px lip on a fully-rounded shape is proven in shipped code. Size was the live question: the bevel range was tuned on 44px controls and this is 32px, so <strong>B5</strong> re-asks the lower bound. It reads here, where at 44px it was a documented no-op &mdash; that bound is per size, not absolute.</p>
  <p class="lede"><strong>B versus C was a second axis, and not a weight.</strong> <code>.chip</code> and <code>.who button</code> are already objects at rest, so selecting one raises something already raised. <code>.stat-sort-chip</code> at rest is <code>background:none</code> with no shadow &mdash; an outline on the paper. Group B changes the selected pill only; group C raises the whole row into parity with the <code>.chips</code> row. C lost on its own terms too: <code>--control</code> is <em>lighter</em> than the sheet, so the strip brightens into five buttons competing with the rank rows below it.</p>
  <p class="lede"><strong>Judge at this size.</strong> Frames are 390px and unscaled. The app's first bevel value shipped from a zoomed render and did nothing in the hand.</p>
  <p class="lede"><strong>The two columns differ here</strong>, unlike <code>seats.html</code>. Since <code>962ac26</code> the fill is <code>--ink</code> on light and <code>:root</code>'s <code>#2E1B3A</code> on dark, and <code>--bevel-lo</code> is mixed from <code>--ink</code> &mdash; so the lower lip has more to bite into on the warm fill than on the purple one.</p>
  <p class="lede"><strong>Coda, and it is not a reversal.</strong> Hours after this was dropped, <code>.who button.on</code> took the pill's <em>fill</em> &mdash; <code>--plum</code> in place of <code>--ink</code> &mdash; so on dark the selected bidder tile is now the same purple as the active pill, which is aubergine dark's <code>--felt</code>: a window through the pad to the table. No depth moved and the seven-vs-one count above is untouched. <strong>A fill is not scarce and a treatment is.</strong> Colour here says <em>weight</em> (the deepest tone the palette carries cream on, which is why it resolves to <code>--ink</code> on light); depth says <em>role</em>. Sharing a weight is free; sharing a role is what was rejected twice.</p>
  <p class="lede"><strong>One thing that swap exposed, which affects the frames below.</strong> <code>--bevel-lo</code> is <code>--ink</code> at 26%, so over a fill of <code>--ink</code> it composites to <code>--ink</code> exactly &mdash; 1.00:1, the pair collapsed to its highlight. <code>.who button.on</code> was in that state in every theme while these variants were being judged, so the bidder tile they were compared against had no lower lip either. <code>.btn-add</code> still has none. Invisible at this alpha either way, but it means two of the seven were never showing the shadow half.</p>
</div>
<div id="out"></div>
<div class="foot">
  <p>Both rows are in every variant because the treatment lands on both and they keep different company: the Stats sort row sits above rank rows with their own gold progress bars, the log's filter row above date headers and game cards. A weight that reads as trim on one can read as a second row of buttons on the other.</p>
  <p>Every depth variant also emits <code>.stat-sort-chip.on:active{transform:scale(.96);box-shadow:none}</code>, because any of them would need it: every beveled control in the app drops its shadow when pressed, and both pill-shaped precedents also scale. No such rule is in the app, which is correct now that nothing shipped &mdash; a flat pill has nothing to drop, and re-tapping the active filter is a no-op anyway. Anyone reviving one of these variants needs that rule with it.</p>
</div>
<script>
const APP_CSS=${js(CSS)}, SCREENS=${js(SCREEN_KEYS.map((k) => ({ k, title: SCREENS[k].title, html: SCREENS[k].html })))},
      VARIANTS=${js(VARIANTS)}, THEMES=${js(THEMES)};
function srcdoc(theme,css,html){
  return '<!doctype html><html data-theme="'+theme+'"><head><meta charset="utf-8">'
    +'<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    +'<style>'+APP_CSS+css+'</style></head><body>'+html+'</body></html>';
}
const out=document.getElementById("out"); let group="";
for(const v of VARIANTS){
  if(v.g!==group){ group=v.g; const h=document.createElement("h2"); h.textContent=group; out.appendChild(h); }
  const row=document.createElement("div"); row.className="row";
  const cap=document.createElement("p"); cap.className="cap"; cap.textContent=v.t; row.appendChild(cap);
  const pair=document.createElement("div"); pair.className="pair";
  for(const s of SCREENS){
    for(const t of THEMES){
      const panel=document.createElement("div"); panel.className="panel";
      const lbl=document.createElement("p"); lbl.className="lbl";
      lbl.textContent=s.title+"  —  "+t.l; panel.appendChild(lbl);
      const f=document.createElement("iframe"); f.setAttribute("scrolling","no");
      f.srcdoc=srcdoc(t.k,v.css,s.html); panel.appendChild(f); pair.appendChild(panel);
    }
  }
  row.appendChild(pair); out.appendChild(row);
}
</script></body></html>`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(DEST, page);
console.log("wrote " + DEST + "  (" + (page.length / 1024).toFixed(0) + "KB)");

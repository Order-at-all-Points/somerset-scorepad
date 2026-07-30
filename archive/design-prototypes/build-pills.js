"use strict";
/**
 * Should the selected filter pill be raised like the bidder tile? -> out/pills.html
 *
 * `.stat-sort-chip.on` -- the active pill in the History log's filter row and the
 * Stats sheet's sort row -- carries `box-shadow:none`. Not a lighter treatment than
 * the other filled controls: none at all. Measured, not eyeballed:
 *
 *   .who button.on   (bidder)   179x44px  radius   8px  bevel + 0 1px 2px/.25
 *   .chip.on         (setting)   89x42px  radius 999px  bevel + 0 1px 2px/.25
 *   .stat-sort-chip.on (filter)  61x32px  radius 999px  NONE
 *
 * Seven rules in index.html carry --bevel-hi. `.stat-sort-chip.on` is the eighth
 * filled, pressable, free-standing control and the only one without it. The other
 * cream-on-fill rules with no bevel are all correctly excluded: badges you do not
 * press (.hist-win-badge, .mbox-slot.win, .stats-form-pill), table headers, and the
 * swipe-revealed .deal-detail-btn/.swipe-action-btn, which sit UNDER a row rather
 * than on top of it.
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
 * THE ROW IS THE ACTUAL DECISION, NOT THE WEIGHT. `.chip` and `.who button` are
 * already objects AT REST -- a --control fill plus 0 1px 2px/.1 -- so selecting one
 * raises something already raised. `.stat-sort-chip` at rest is `background:none`
 * with no shadow: an outline drawn on the paper. Adding the full treatment to `.on`
 * alone (group B) makes the selected pill the only three-dimensional object in a row
 * of flat outlines, which may read as it detaching from the row rather than rising
 * within it. Group C raises the whole row instead, which is true structural parity
 * with the .chips row -- and risks turning filter chrome you are meant to look past
 * into five pieces of furniture on the stats sheet. B and C are not weights of the
 * same idea; they are different claims about what the row is.
 *
 * A COMPANION RULE IS REQUIRED, and it is not optional dressing. There is no
 * `.stat-sort-chip.on:active` in the app at all today -- correct while the pill is
 * flat, since re-tapping the active filter is a no-op and there is nothing to drop.
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
 * identical to the bidder tile's -- both resolve to --ink, rgb(44,38,32) -- so two
 * controls now share a fill while one is raised and one is flat. The inconsistency
 * predates the change; the change is what made it visible.)
 *
 * JUDGE AT TRUE DEVICE SCALE. Frames are 390px and unscaled. These are 1px effects
 * on a 32px control and a zoomed frame is precisely what lies about those -- the
 * app's first bevel value shipped from a zoomed render and did nothing in the hand.
 *
 * SETTLED -- B3 shipped: the three-layer shadow copied unmodified, and the row left
 * as outlines. Two things the rendering decided that the argument could not.
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
 * -- which is the argument for B3 over B4/B5: a lighter pair would be a new value
 * to name and defend for no gain.
 *
 * B1 IS THE RUNNER-UP AND WORTH KNOWING ABOUT: the lip with no lift, so the fill
 * gets a top-lit edge but stays flush with the paper. It is the more restrained
 * answer and the right one if this row should read flatter than the bidder tile.
 * It lost only because the question was consistency with that tile, which B1 by
 * definition does not deliver.
 *
 * B6 does not earn its weight. A pill in a scrolling row seemed like it might want
 * .seat's two-layer card shadow rather than the button lift; it renders fine, softer
 * and more spread. But d389923 justified that treatment by the tile REPRESENTING a
 * physical card. A filter pill is a control, not an object, so the button vocabulary
 * is the one it belongs to.
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
   AT REST (.chip, .who button, .step, and today's .seat), /.25 is the raised-fill
   signature the seven beveled controls carry when active. `card` is the two-layer
   treatment d389923 gave .seat -- a thin object lying on paper rather than a button
   standing on it, which is arguably what a pill in a scrolling row is. */
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

/* Emits the selected pill, the :active companion the app's convention requires (see
   the header -- there is no .on:active rule today), and optionally the at-rest row. */
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
const GB = "B - The PILL only: siblings stay flat outlines, one object rises out of the row";
const GC = "C - The ROW: unselected pills become objects at rest too, as .chip and .who button already are";
const GD = "D - Bounds, kept";

const VARIANTS = [
  { g: GA, t: "A1 - Current: box-shadow:none. The only filled pressable control in the app with no depth at all",
    css: `` },

  { g: GB, t: "B1 - Inner lip only, no lift: the fill gets a top-lit edge but stays flush with the sheet  (still a drawn thing, not an object)",
    css: pill({ inset: EDGE.ship }) },
  { g: GB, t: "B2 - Lift only, no lip: 0 1px 2px/.25, the raised-fill weight  (isolates whether the lift or the lip is doing the work)",
    css: pill({ lift: LIFT.fill }) },
  /* SHIPPED. Empty css so this row renders whatever index.html currently says
     rather than a copy of it that can rot -- same convention as build-button.js
     and build-seats.js. If the live rule changes, this row changes with it. */
  { g: GB, t: "B3 - SHIPPED: the exact three-layer shadow .chip.on and .who button.on carry, unmodified. Renders live from index.html, not a copy",
    css: `` },
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

  { g: GD, t: "D1 - Lip at 48/40: past the ~45% ceiling the --bevel-* note names. The key-cap failure, at pill radius, kept so B3 is legible as a choice",
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
<title>SomeRSet &mdash; should the filter pill be raised?</title>
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
    <tr><td><code>.stat-sort-chip.on</code> &mdash; a filter</td><td>61&times;32</td><td>999px</td><td class="no">none</td></tr>
  </table>
  <p class="lede"><strong>The radius objection is already dead.</strong> <code>.chip.on</code> is <code>--r-pill</code> at radius 999px and has carried the identical bevel since <code>fa01439</code>, so a 1px lip on a fully-rounded shape is proven in shipped code. What is <em>not</em> settled is size: the bevel range was tuned on 44px controls and this is 32px, so <strong>B5</strong> re-asks the lower bound rather than assuming it transfers.</p>
  <p class="lede"><strong>B versus C is the real decision, and it is not a weight.</strong> <code>.chip</code> and <code>.who button</code> are already objects at rest, so selecting one raises something already raised. <code>.stat-sort-chip</code> at rest is <code>background:none</code> with no shadow &mdash; an outline on the paper. Group B lets one object rise out of a row of flat outlines; group C raises the whole row into parity with the <code>.chips</code> row. Two different claims about what the row <em>is</em>.</p>
  <p class="lede"><strong>Judge at this size.</strong> Frames are 390px and unscaled. The app's first bevel value shipped from a zoomed render and did nothing in the hand.</p>
  <p class="lede"><strong>The two columns differ here</strong>, unlike <code>seats.html</code>. Since <code>962ac26</code> the fill is <code>--ink</code> on light and <code>:root</code>'s <code>#2E1B3A</code> on dark, and <code>--bevel-lo</code> is mixed from <code>--ink</code> &mdash; so the lower lip has more to bite into on the warm fill than on the purple one.</p>
</div>
<div id="out"></div>
<div class="foot">
  <p>Both rows are in every variant because the treatment lands on both and they keep different company: the Stats sort row sits above rank rows with their own gold progress bars, the log's filter row above date headers and game cards. A weight that reads as trim on one can read as a second row of buttons on the other.</p>
  <p>Every depth variant also emits <code>.stat-sort-chip.on:active{transform:scale(.96);box-shadow:none}</code>. There is no such rule in the app today &mdash; correct while the pill is flat, since re-tapping the active filter is a no-op and there is nothing to drop. Without it the selected pill would be the one raised control in the app that stays raised when pressed.</p>
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

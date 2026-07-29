"use strict";
/**
 * What gives a seat tile depth? -> out/seats.html
 *
 * The four `.seat` tiles are the flattest objects on the pad: a 1.5px gold border,
 * a flat --control fill and `0 1px 2px rgba(0,0,0,.1)`. They are meant to read as
 * players sitting at a table, and they read as four labels.
 *
 * The question here is ONLY the tile. An earlier pass asked whether to draw a
 * surface under them -- an ellipse, tinted or ruled or felted, as `.table::before`
 * -- and that was the wrong question: it answers "the diagram looks flat" by adding
 * a thing to the diagram, when the pad is already paper on a card table and the
 * felt is three inches away on either side. Three of those rows are kept at the
 * bottom under REJECTED FRAMING, because one of them produced a finding worth
 * keeping. Nothing here adds an element; every variant styles `.seat` and nothing
 * else.
 *
 * THE DEALER TILE IS THE CONSTRAINT, and it is why each variant below is two rules
 * rather than one. `.seat.dealer` carries `inset 0 0 0 2px var(--brass)` in its own
 * box-shadow, so any depth added to `.seat` is overwritten on exactly the tile the
 * eye goes to first. Every variant restates the dealer with the brass ring AND the
 * new depth, insets first so the tile's outer lip stays on top of the ring rather
 * than under it. A treatment that cannot compose with that ring is not a candidate,
 * however good it looks on the other three.
 *
 * The bevel row (B3) is deliberately testing a rule the app already wrote down.
 * fa01439 gave --bevel-hi/--bevel-lo to the seven filled controls and explicitly
 * held them off .btn-cancel and the plain .sheet-btn, on the grounds that they are
 * "near-white on cream, where an inner shadow reads as grubby rather than raised".
 * `.seat` is --control on --cream: the same case, so by that rule it should be
 * excluded. It differs in one way that might matter -- a 1.5px GOLD border, which
 * gives an inner lip something to sit inside instead of fading into the fill. That
 * is a reason to render it, not a reason to assume either answer.
 *
 * On texture specifically: the app ships no image assets and should not start, so
 * grain has to be CSS. Two honest ways -- an feTurbulence SVG as a data URI (real
 * stochastic grain, ~300 bytes, tiles at 140px, so no two seats show the same
 * patch) and a repeating-linear-gradient (a laid rule, cheaper and regular). Both
 * are LADDERED in group C, and both first attempts are kept as bounds because both
 * were failures in opposite directions: turbulence at 5% is imperceptible on a
 * near-white fill even zoomed, and a laid rule at a 1-in-4px pitch is not texture
 * at 96px wide, it is corduroy, and it competes with the name sitting on it. The
 * failure mode at the other end is a tile that reads as screen noise or a JPEG
 * artifact rather than card stock. All of that is a device-scale judgement.
 *
 * JUDGE AT TRUE DEVICE SCALE. Frames are 390px wide and unscaled. Most of these
 * are 1px effects and a zoomed frame is exactly what lies about those -- see the
 * README, and note that the first bevel value in the app shipped from a zoomed
 * render and was a no-op in the hand.
 *
 * OPEN -- nothing applied. `A - Current` is the live file and stays the live file
 * until something wins.
 *
 *   node archive/design-prototypes/capture-screens.js   # first, once
 *   node archive/design-prototypes/build-seats.js
 *   node archive/design-prototypes/serve.js             # open /seats.html
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const SRC = path.join(OUT, "screens.json");
const DEST = path.join(OUT, "seats.html");

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
const SCREEN = SCREENS["game-play"];
if (!SCREEN) {
  console.error("screens.json has no 'game-play' entry -- it predates this generator.\n" +
                "Rerun: node archive/design-prototypes/capture-screens.js");
  process.exit(1);
}

/* How far off the paper. The app already has a vocabulary here: 0 1px 2px/.1 is
   what a SECONDARY control casts (.btn-cancel, the plain .sheet-btn, and today's
   .seat), 0 1px 2px/.25 is the raised-fill signature carried by the seven controls
   that took the bevel. A playing card is neither of those -- it is a thin object
   with a soft contact shadow, which wants a second, longer, weaker layer. */
const LIFT = {
  cur:  "0 1px 2px rgba(0,0,0,.1)",
  fill: "0 1px 2px rgba(0,0,0,.25)",
  card: "0 1px 1px rgba(0,0,0,.14), 0 3px 8px rgba(0,0,0,.10)",
  far:  "0 2px 3px rgba(0,0,0,.28), 0 8px 18px rgba(0,0,0,.16)",
};

/* Fills. --control is #FCF6E6 on a --cream #F6EEDC pad -- a 1.05:1 difference, so
   the tile is currently doing all its separating with the border. A gradient gives
   the face a direction without touching that ratio at the top edge. */
const dome = (pct) =>
  `linear-gradient(var(--control) 0%, color-mix(in srgb, var(--control) ${pct}%, var(--cream-shade)) 100%)`;
const FILL = {
  dome: dome(62),
  domeUp: dome(40),
  /* The same gradient inverted. Wrong by the app's light model (every other depth
     treatment assumes light from above) and here to show that it looks wrong
     rather than to be argued about. */
  cup:  "linear-gradient(color-mix(in srgb, var(--control) 62%, var(--cream-shade)) 0%, var(--control) 100%)",
};

/* Grain. No image assets in the app and none being added, so both of these are
   inline. The turbulence tile is ~300 bytes and repeats at 140px, well over the
   96px tile width, so no two seats show the same patch.
   BOTH ARE LADDERED, and the first values tried are kept as the lower bound
   because both were no-ops. Turbulence at .05 is imperceptible on a near-white
   fill even zoomed -- the same failure as the app's first bevel value, which
   shipped for one commit and did nothing. The laid rule went the other way: a
   1-in-4px pitch is not texture at 96px wide, it is corduroy, and it competes with
   the name it sits behind. The useful settings are somewhere between. */
const grain = (op) =>
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E" +
  "%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E" +
  "%3C/filter%3E%3Crect width='140' height='140' filter='url(%23g)' opacity='" + op + "'/%3E%3C/svg%3E\")";
const GRAIN = { lo: grain(".05"), mid: grain(".12"), hi: grain(".22") };
const laid = (alpha, pitch) =>
  `repeating-linear-gradient(90deg, color-mix(in srgb, var(--ink) ${alpha}%, transparent) 0 1px, transparent 1px ${pitch}px)`;
const LAID = { coarse: laid(3.5, 4), fine: laid(2.5, 2) };

/* Inner edges. --bevel-* is the app's existing raised lip; the highlight-only row
   isolates whether the dark lower lip is the part that reads as grubby on a
   near-white fill, which is what fa01439 asserted without testing it here. */
const EDGE = {
  bevel: "inset 0 1px 0 var(--bevel-hi), inset 0 -1px 0 var(--bevel-lo)",
  hiOnly: "inset 0 1px 0 var(--bevel-hi)",
};

/* Emits both rules. `.seat.dealer` has to be restated or the brass ring wipes the
   depth off the one tile that matters most -- see the header. Insets go before the
   ring so the tile's own lip paints over it rather than under. */
function seat(o) {
  const inset = o.inset ? o.inset + ", " : "";
  const lift = o.lift || LIFT.cur;
  const face = o.fill ? "background-image:" + o.fill + ";" : "";
  return `.seat{box-shadow:${inset}${lift};${face}}` +
         `.seat.dealer{box-shadow:${inset}inset 0 0 0 2px var(--brass), ${lift};${face}}`;
}

const GA = "A - How far off the paper?  (shadow only; fill, border and everything else untouched)";
const GB = "B - Does the tile want an inner edge?  (at the lift from A that you preferred; here shown on the card shadow)";
const GC = "C - Card stock: does the face want texture?  (on the card shadow, no inner edge)";
const GD = "D - Worth combining?";
const GE = "REJECTED FRAMING - a surface drawn under the seats, kept for one finding";

/* Kept from the first pass. The question was wrong -- the pad is already paper on
   a card table -- but the felt row produced something worth not re-deriving, so
   three rows stay rather than the whole set. */
const surface = (paint) =>
  `.table::before{content:"";position:absolute;inset:0;border-radius:50%;pointer-events:none;${paint}}`;

const VARIANTS = [
  { g: GA, t: "A1 - Current: 0 1px 2px rgba(0,0,0,.1), the app's SECONDARY-control shadow (.btn-cancel casts the same one)",
    css: `` },
  { g: GA, t: "A2 - Raised-fill signature: 0 1px 2px rgba(0,0,0,.25), the weight the seven beveled controls carry",
    css: seat({ lift: LIFT.fill }) },
  { g: GA, t: "A3 - Card shadow: a tight contact shadow plus a longer, weaker one -- a thin object resting on paper rather than a button standing on it",
    css: seat({ lift: LIFT.card }) },
  { g: GA, t: "A4 - Too far: the upper bound, kept so A3 is legible as a choice rather than a number  (tiles start floating above the pad instead of lying on it)",
    css: seat({ lift: LIFT.far }) },

  { g: GB, t: "B1 - No inner edge (A3 alone), for comparison",
    css: seat({ lift: LIFT.card }) },
  { g: GB, t: "B2 - Highlight only: the top inner lip, no dark lower lip",
    css: seat({ lift: LIFT.card, inset: EDGE.hiOnly }) },
  { g: GB, t: "B3 - Full --bevel pair: the treatment fa01439 deliberately withheld from near-white-on-cream controls -- the gold border may be the thing that makes it work here  (see header)",
    css: seat({ lift: LIFT.card, inset: EDGE.bevel }) },

  { g: GC, t: "C1 - Flat face (A3 alone), for comparison",
    css: seat({ lift: LIFT.card }) },
  { g: GC, t: "C2 - Domed: a vertical gradient toward --cream-shade, so the face has a direction",
    css: seat({ lift: LIFT.card, fill: FILL.dome }) },
  { g: GC, t: "C3 - Domed harder: the same gradient run further  (the point where the tile stops being one colour)",
    css: seat({ lift: LIFT.card, fill: FILL.domeUp }) },
  { g: GC, t: "C4 - Cupped: C2 inverted -- wrong by the app's light model, here to be seen rather than argued about",
    css: seat({ lift: LIFT.card, fill: FILL.cup }) },
  { g: GC, t: "C5 - Grain at 5%: the lower bound, and a NO-OP -- kept for the same reason build-button.js keeps 22/18, because a value that does nothing still looks like a decision in the diff",
    css: seat({ lift: LIFT.card, fill: GRAIN.lo }) },
  { g: GC, t: "C6 - Grain at 12%: inline feTurbulence, tiling at 140px so no two tiles show the same patch",
    css: seat({ lift: LIFT.card, fill: GRAIN.mid }) },
  { g: GC, t: "C7 - Grain at 22%: the upper bound  (watch for it reading as screen noise or JPEG artifact rather than card stock)",
    css: seat({ lift: LIFT.card, fill: GRAIN.hi }) },
  { g: GC, t: "C8 - Laid at a 1-in-4px pitch: the regular alternative to stochastic grain, and too coarse -- at 96px wide this is corduroy, not stock, and it competes with the name",
    css: seat({ lift: LIFT.card, fill: LAID.coarse }) },
  { g: GC, t: "C9 - Laid at a 1-in-2px pitch, lower alpha: fine enough to read as a surface rather than a pattern",
    css: seat({ lift: LIFT.card, fill: LAID.fine }) },

  { g: GD, t: "D1 - Card shadow + dome",
    css: seat({ lift: LIFT.card, fill: FILL.dome }) },
  { g: GD, t: "D2 - Card shadow + dome + highlight lip",
    css: seat({ lift: LIFT.card, inset: EDGE.hiOnly, fill: FILL.dome }) },
  { g: GD, t: "D3 - Card shadow + grain (12%) over dome",
    css: seat({ lift: LIFT.card, fill: GRAIN.mid + ", " + FILL.dome }) },
  { g: GD, t: "D4 - Everything: card shadow + grain over dome + full bevel  (the bound on this axis -- four treatments on a 96px tile)",
    css: seat({ lift: LIFT.card, inset: EDGE.bevel, fill: GRAIN.mid + ", " + FILL.dome }) },

  { g: GE, t: "E1 - Ruled ellipse at --rule-soft: the least-bad version of the wrong idea",
    css: surface("border:1px solid var(--rule-soft);") },
  { g: GE, t: "E2 - Tinted ellipse at --cream-shade",
    css: surface("background:var(--cream-shade);") },
  { g: GE, t: "E3 - Felt inlay: THE FINDING. --brass tokens (the DEALER tag, the arrow) were chosen to sit on cream and lose their ground entirely -- and this is the only row on the whole page where the two theme columns differ, because it is the only one reaching across the pad/felt boundary",
    css: surface("background:radial-gradient(ellipse at 50% 28%, var(--felt) 0%, var(--felt-deep) 100%);" +
                 "box-shadow:inset 0 1px 3px rgba(0,0,0,.35);") },
];

const THEMES = [
  { k: "aubergine", l: "Dark" },
  { k: "aubergine-light", l: "Light  (identical inside the pad in every row but E3 -- see the README trap)" },
];

/* index.html's CSS comments contain "</scr"+"ipt>", which would terminate the
   embedding block. Escaping "<" is the standard mitigation. */
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003C");

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SomeRSet &mdash; what gives a seat tile depth?</title>
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
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8E8476;
     margin:30px 0 0;padding:18px max(16px,env(safe-area-inset-left)) 0;border-top:1px solid #2A2532}
  .row{padding:14px max(16px,env(safe-area-inset-left)) 0}
  .cap{margin:0 0 8px;font-size:13px;font-weight:600;color:#F3ECDF;max-width:74ch}
  .pair{display:flex;gap:14px;flex-wrap:wrap}
  .panel{flex:0 0 390px;max-width:100%;min-width:0}
  .panel .lbl{font-size:11px;color:#8E8476;margin:0 0 4px}
  /* 390px and unscaled: most of these are 1px effects, and a zoomed frame is
     exactly what lies about those. See the README. */
  .panel iframe{width:100%;height:470px;border:0;display:block;border-radius:9px;border:1px solid #332D3D}
  .foot{margin-top:44px;color:#8E8476;font-size:13px;border-top:1px solid #2A2532;
        padding:18px max(16px,env(safe-area-inset-left)) 0;max-width:80ch}
  .foot code{background:#1E1A26;padding:1px 5px;border-radius:4px;font-size:12px}
  @media(max-width:560px){.lede{font-size:13px}}
</style></head><body>
<div class="pagepad">
  <h1 class="pt">What gives a seat tile depth?</h1>
  <p class="lede">Real captured DOM (<code>game-play</code>, three deals in) under the app's real CSS. Every variant styles <code>.seat</code> and nothing else &mdash; no new elements, no change to <code>renderTable()</code>, no surface under the tiles.</p>
  <p class="lede"><strong>Judge at this size.</strong> Frames are 390px and unscaled. Most of these are 1px effects, and a zoomed comparison makes every one of them look like a decision was made.</p>
  <p class="lede"><strong>Watch the dealer tile.</strong> <code>.seat.dealer</code> owns its own <code>box-shadow</code> for the brass ring, so it silently drops any depth added to <code>.seat</code>. Every variant here restates it &mdash; a treatment that will not compose with that ring is not a candidate no matter how the other three look.</p>
  <p class="lede">Groups B, C and D all sit on <strong>A3</strong>, the card shadow, so only one thing moves per row. If A2 or A4 turns out to be the lift you want, say so and the rest gets rebuilt on it.</p>
</div>
<div id="out"></div>
<div class="foot">
  <p>The scoreboard above and the deal rows below are in every frame deliberately. Four tiles that read well in isolation can turn the middle of the pad into the loudest thing on it, which is the failure mode to watch for in A4 and D4.</p>
</div>
<script>
const APP_CSS=${js(CSS)}, HTML=${js(SCREEN.html)}, VARIANTS=${js(VARIANTS)}, THEMES=${js(THEMES)};
function srcdoc(theme,css){
  return '<!doctype html><html data-theme="'+theme+'"><head><meta charset="utf-8">'
    +'<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    +'<style>'+APP_CSS+css+'</style></head><body>'+HTML+'</body></html>';
}
const out=document.getElementById("out"); let group="";
for(const v of VARIANTS){
  if(v.g!==group){ group=v.g; const h=document.createElement("h2"); h.textContent=group; out.appendChild(h); }
  const row=document.createElement("div"); row.className="row";
  const cap=document.createElement("p"); cap.className="cap"; cap.textContent=v.t; row.appendChild(cap);
  const pair=document.createElement("div"); pair.className="pair";
  for(const t of THEMES){
    const panel=document.createElement("div"); panel.className="panel";
    const lbl=document.createElement("p"); lbl.className="lbl"; lbl.textContent=t.l; panel.appendChild(lbl);
    const f=document.createElement("iframe"); f.setAttribute("scrolling","no");
    f.srcdoc=srcdoc(t.k,v.css); panel.appendChild(f); pair.appendChild(panel);
  }
  row.appendChild(pair); out.appendChild(row);
}
</script></body></html>`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(DEST, page);
console.log("wrote " + DEST + "  (" + (page.length / 1024).toFixed(0) + "KB)");

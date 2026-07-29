"use strict";
/**
 * The cream label on a brass fill fails AA. What can carry it? -> out/brass.html
 *
 * Eleven rules across the app say `background:var(--brass); color:var(--cream)`
 * -- .btn-record and .btn-new, .sheet-btn.primary, .chip.on, .hist-win-badge,
 * .mbox-slot.win, the round-robin champion row, the grand-final header, the undo
 * toast's button, and the two edit buttons. In the two live themes that pairing
 * measures 2.50:1, against AA's 4.5. It is the app's primary GO control and the
 * one thing on screen you look at while holding cards.
 *
 * Three directions, and measurement kills one of them outright:
 *
 *                        aubergine  aubergine-light   dark   light
 *   cream on --brass        2.50         2.50         3.22    7.30   <- shipped
 *   ink on --brass          5.19         5.19         3.71    1.77   <- dead
 *   cream on --brass-text   5.02         5.02         5.26    8.81   <- passes
 *
 * Darkening the LABEL to --ink and keeping the gold looks like the change that
 * preserves the most, and it does in three themes. But Classic Light's --brass
 * is not gold at all -- Linen Daylight promotes the felt's green to the accent
 * (#2F5D48), and dark ink on dark green is 1.77:1, far worse than what it
 * replaces. It would need a per-theme label colour, and it inverts the button's
 * light-label-on-colour grammar in exactly one theme. Row 2 renders that, so the
 * failure is visible rather than asserted.
 *
 * Darkening --brass itself is the other obvious move and is not tried here:
 * --brass is also every hairline rule on cream, the double rules under view
 * heads, focus rings and the score-bar fill, where the lighter tone is correct
 * and already contrasts fine. The palette deliberately carries two brasses. This
 * is just the fills using the wrong one of them.
 *
 * SHIPPED: the deep brass, via a new --brass-deep. It holds the value and
 * --brass-text aliases to it, so the ~30 text uses are untouched and a fill can
 * stop asking for a token named "text". .banner already shipped this exact
 * pairing (deep brass ground, cream label), which is why row 3 needs no argument
 * that it fits -- it is already in the app, one element up from the score pad.
 *
 *   node archive/design-prototypes/build-brass.js
 *   node archive/design-prototypes/serve.js   # then open /brass.html
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const DEST = path.join(OUT, "brass.html");

const APP = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
/* Anchor on the <style> tag alone on its own line; a plain indexOf() finds the
   words "<style>" in a comment first and silently drops :root. See build-press.js. */
const STYLE_AT = APP.search(/^<style>$/m);
if (STYLE_AT < 0) throw new Error("no <style> element found in index.html");
const CSS = APP.slice(STYLE_AT + 7, APP.indexOf("</style>", STYLE_AT));
if (!/:root\s*\{/.test(CSS)) throw new Error("extracted CSS has no :root block");

/* The controls that actually carry a cream label on brass, on the pad they live
   on. .btn-record sits in .entry-actions next to .btn-cancel -- the pair is the
   point, since whatever the primary becomes has to stay obviously primary next
   to a control that did not change. */
const MARKUP = `<div class="wrap"><div class="pad">
  <div class="banner">Keith &amp; Sam win</div>
  <div style="padding:14px 16px">
    <p class="phase-label">Step 2 · after the hand</p>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="chip">6</button><button class="chip on">7</button><button class="chip">8</button>
    </div>
    <div class="entry-actions" style="display:flex;gap:8px">
      <button class="btn-cancel">Cancel</button>
      <button class="btn-record">Record Take</button>
    </div>
    <p style="margin:14px 0 4px"><span class="hist-win-badge">Keith &amp; Sam won</span></p>
    <button class="btn-new" style="margin-top:10px">New Game</button>
  </div>
</div></div>`;

/* Applied after the app's own CSS, so a bare [data-theme] override outranks
   nothing and simply wins on source order -- same trick as build-press.js. */
const FILLS = ".btn-record,.btn-new,.sheet-btn.primary,.chip.on,.hist-win-badge,.mbox-slot.win,.bracket-section-head.gf";

const VARIANTS = [
  { g: "The cream label on a brass fill",
    t: "cream on --brass  (before this change — 2.50:1, AA wants 4.5)",
    css: `${FILLS}{background:var(--brass);color:var(--cream)}.banner{background:var(--brass);color:var(--cream)}` },
  { g: "The cream label on a brass fill",
    t: "keep the gold, darken the label to --ink  (rejected: 1.77:1 in Classic Light, where --brass is green)",
    css: `${FILLS}{background:var(--brass);color:var(--ink)}` },
  { g: "The cream label on a brass fill",
    t: "cream on the deep brass  (SHIPPED — what .banner above has always used)", css: `` },

  { g: "Next to the controls that did not change",
    t: "primary vs .btn-cancel, and .chip.on vs an unselected .chip  (SHIPPED)", css: `` },
  { g: "Next to the controls that did not change",
    t: "same, with the old fill — the primary is brighter but not darker than its own label",
    css: `${FILLS}{background:var(--brass);color:var(--cream)}` },
];

const THEMES = [
  { k: "aubergine", l: "Dark" },
  { k: "aubergine-light", l: "Light" },
  { k: "dark", l: "Classic Dark" },
  { k: "light", l: "Classic Light — --brass is green here" },
];

/* index.html's CSS comments contain "</scr"+"ipt>", which would terminate the
   embedding block. Escaping "<" is the standard mitigation. */
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003C");

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SomeRSet — what carries the cream label?</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box} html,body{margin:0}
  body{font:15px/1.5 -apple-system,system-ui,sans-serif;background:#121016;color:#EDE6DA;
       padding:0 0 50px;-webkit-text-size-adjust:100%}
  .pad{padding:20px max(16px,env(safe-area-inset-left)) 0}
  h1.pt{font-size:19px;margin:0 0 6px;font-weight:650}
  .lede{margin:0 0 8px;color:#A79C8D;font-size:14px;max-width:70ch}
  .lede code{color:#D8CDB9}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8E8476;
     margin:26px 0 0;padding:16px max(16px,env(safe-area-inset-left)) 0;border-top:1px solid #2A2532}
  .row{padding:10px max(16px,env(safe-area-inset-left)) 0}
  .cap{margin:0 0 6px;font-size:13px;font-weight:600;color:#F3ECDF}
  .pair{display:flex;gap:12px;flex-wrap:wrap}
  .panel{flex:1 1 260px;min-width:0}
  .panel .lbl{font-size:11px;color:#8E8476;margin:0 0 4px}
  .panel iframe{width:100%;height:330px;border:0;display:block;border-radius:9px;border:1px solid #332D3D}
  @media(max-width:560px){.lede{font-size:13px}}
</style></head><body>
<div class="pad">
  <h1 class="pt">What carries the cream label?</h1>
  <p class="lede">Real markup, real CSS. Eleven rules pair <code>--cream</code> with a <code>--brass</code> fill and measure <strong>2.50:1</strong> in both live themes. Note the <code>.banner</code> at the top of each panel — it never used <code>--brass</code>, and it is the look row 3 adopts everywhere else.</p>
</div>
<div id="out"></div>
<script>
const APP_CSS=${js(CSS)}, MARKUP=${js(MARKUP)}, VARIANTS=${js(VARIANTS)}, THEMES=${js(THEMES)};
function srcdoc(theme,css){
  return '<!doctype html><html data-theme="'+theme+'"><head><meta charset="utf-8">'
    +'<style>'+APP_CSS+css+'body{padding:14px 10px;min-height:100vh}.wrap{margin:0 auto}</style>'
    +'</head><body>'+MARKUP+'</body></html>';
}
const out=document.getElementById("out"); let group="";
for(const v of VARIANTS){
  if(v.g!==group){ group=v.g; const h=document.createElement("h2"); h.textContent=group; out.appendChild(h); }
  const row=document.createElement("div"); row.className="row";
  row.innerHTML='<p class="cap">'+v.t+'</p>';
  const pair=document.createElement("div"); pair.className="pair";
  for(const t of THEMES){
    const panel=document.createElement("div"); panel.className="panel";
    panel.innerHTML='<p class="lbl">'+t.l+'</p>';
    const f=document.createElement("iframe"); f.setAttribute("scrolling","no");
    f.srcdoc=srcdoc(t.k,v.css); panel.appendChild(f); pair.appendChild(panel);
  }
  row.appendChild(pair); out.appendChild(row);
}
</script></body></html>`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(DEST, page);
console.log("wrote " + DEST + "  (" + (page.length / 1024).toFixed(0) + "KB)");

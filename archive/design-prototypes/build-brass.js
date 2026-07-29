"use strict";
/**
 * The cream label on a brass fill is below AA. Kept anyway. -> out/brass.html
 *
 * PARKED -- nothing here is applied. This generator exists to record a decision
 * that went against the measurement, and to make it cheap to revisit.
 *
 * Eleven rules say `background:var(--brass); color:var(--cream)` -- .btn-record
 * and .btn-new, .sheet-btn.primary, .chip.on, .hist-win-badge, .mbox-slot.win,
 * the round-robin champion row, the grand-final header, the undo toast's button,
 * and the two edit buttons. In the live themes that measures 2.50:1 against AA's
 * 4.5, on the primary GO control.
 *
 * Both fixes were built and shipped, and both were reverted on looking at them:
 *
 *                              aubergine  aubergine-light   dark   light
 *   cream on --brass (SHIPPED)    2.50         2.50         3.22    7.30
 *   near-black on --brass         5.19         5.19         3.71    1.77
 *   cream on --brass-text         5.02         5.02         5.26    8.81
 *
 * The arithmetic leaves no fourth option, which is the useful part to know
 * before trying again. --brass sits at luminance .314. A cream label at 4.5:1
 * forces its ground below .152, so the gold cannot merely be darkened; and on
 * that same gold a passing label needs luminance <= .031, which is a whisker off
 * black. Either the button stops being gold or the label stops being light.
 * Row 2 is what "keep the gold" actually looks like -- the label goes to --ink --
 * and row 3 is what "keep the light label" costs: .btn-record turns a dark olive
 * and stops out-weighing .btn-add, the neutral dark secondary beside it.
 *
 * Judged 2026-07-29: reads fine in the hand, keep the gold and the cream. The
 * app is a card-table scorepad held at arm's length, its label is 17px 600, and
 * the failing pair is a large button with a shadow and a border, not body text.
 * That is a defensible call rather than a compliant one, and it is written down
 * here and beside the token in index.html so it is not silently re-fixed a third
 * time.
 *
 * Note the live themes are the whole issue. Classic Light's --brass is the felt's
 * green (#2F5D48) and carries cream at 7.30 unaided -- it never failed, and
 * treating it as part of the problem is what first made "move the label" look
 * impossible, since ink on that green is 1.77.
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
  { g: "What carries the label on a filled brass control",
    t: "cream on --brass  (SHIPPED — 2.50:1, below AA, kept deliberately)", css: `` },
  { g: "What carries the label on a filled brass control",
    t: "keep the gold, move the label  (built and reverted: AA forces the label to within a whisker of black)",
    css: `${FILLS}{background:var(--brass);color:var(--ink)}` },
  { g: "What carries the label on a filled brass control",
    t: "keep the light label, darken the ground  (built and reverted: the primary GO control turns dark olive)",
    css: `${FILLS}{background:var(--brass-text);color:var(--cream)}` },

  { g: "Next to the controls that never changed",
    t: "primary vs .btn-cancel, .chip.on vs an unselected .chip  (SHIPPED)", css: `` },
  { g: "Next to the controls that never changed",
    t: "same with the darkened ground — note it stops out-weighing .btn-add, the neutral dark secondary",
    css: `${FILLS}{background:var(--brass-text);color:var(--cream)}` },
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
  <p class="lede">Real markup, real CSS. Eleven rules pair <code>--cream</code> with a <code>--brass</code> fill and measure <strong>2.50:1</strong> in the live themes, under the 4.5 AA wants — and that is what ships. Both fixes were built, shipped and reverted; rows 2 and 3 are them. Note the <code>.banner</code> at the top of each panel, which has always used the darker brass and is the look row 3 spreads everywhere.</p>
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

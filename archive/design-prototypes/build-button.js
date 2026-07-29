"use strict";
/**
 * How much bevel does a raised control want? -> out/button.html
 *
 * The app had two depth treatments and both press INWARD: --mast-* stamps text
 * into the felt, --press-* stamps the 48px totals into the pad. Both are
 * shadow-up / highlight-down, because light reads as coming from above and the
 * upper inner wall of an impression is the part that falls into shade.
 *
 * A raised control is that same optics inverted -- the top inner lip catches the
 * light, the bottom inner lip is in shade -- so --bevel-hi/--bevel-lo go
 * highlight-first. Seven controls take it: .btn-record, .btn-new, .btn-add,
 * .btn-danger, .sheet-btn.primary, .chip.on and .who button.on, i.e. everything
 * already carrying the raised-fill signature `0 1px 2px rgba(0,0,0,.25)`.
 *
 * Nothing is needed on :active. Every one of those controls already sets
 * box-shadow:none when pressed, so the bevel drops with the lift for free and
 * the existing press gesture (scale .93-.98) is untouched.
 *
 * JUDGE THIS ONE AT TRUE DEVICE SCALE. A 1px lip is exactly what a zoomed
 * comparison lies about: at 3x these rows separate clearly and the bottom of the
 * ladder looks like a real choice, while on a 390px viewport at DPR 3 it is
 * invisible. Every value below was picked from phone-scale renders and the
 * iframes here are 390px wide for the same reason. The first pass shipped 22/18
 * off a zoomed render; it was a no-op on a phone.
 *
 * That is the lower bound: below ~25% the bevel does nothing except look like a
 * decision was made. The upper bound is house style -- past ~45% it reads as a
 * glossy key-cap (row 4), which is a different product from a baize scorepad.
 *
 * What does NOT bound it, contrary to the obvious guess: the label. Cream on
 * brass is 2.50:1 and deliberately kept (see the note in index.html), so it
 * would be reasonable to expect the lower lip to start eating descenders. Render
 * row 3 and it plainly does not, even at double the shipped weight -- the inner
 * shadow lands on the button's bottom edge, several pixels clear of the text.
 * That row is kept precisely because it disproves a plausible-sounding reason.
 *
 * Warm rather than neutral (row 5): mixed from --cream and --ink rather than
 * white and black, for the same reason --press-lo is a warm brown. Every control
 * this lands on is saturated (brass, red) or near-black, and a neutral pair
 * cools them. At hairline alphas it is a small difference, but it costs nothing
 * and keeps all three depth treatments in one family.
 *
 * SHIPPED: --bevel-hi at 32% cream, --bevel-lo at 26% ink, 1px each.
 *
 *   node archive/design-prototypes/build-button.js
 *   node archive/design-prototypes/serve.js   # then open /button.html
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const DEST = path.join(OUT, "button.html");

const APP = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
/* Anchor on the <style> tag alone on its own line; a plain indexOf() finds the
   words "<style>" in a comment first and silently drops :root. See build-press.js. */
const STYLE_AT = APP.search(/^<style>$/m);
if (STYLE_AT < 0) throw new Error("no <style> element found in index.html");
const CSS = APP.slice(STYLE_AT + 7, APP.indexOf("</style>", STYLE_AT));
if (!/:root\s*\{/.test(CSS)) throw new Error("extracted CSS has no :root block");

/* One of each ground the bevel has to work on: brass (the primary), --ink (the
   neutral secondary, where only the top highlight can register), --red
   (destructive), and the two smaller pill-shaped controls. .btn-cancel is in the
   row because the bevel deliberately does NOT reach it -- it is --control, a
   near-white on cream, where an inner shadow reads as grubby rather than raised,
   and its lighter 0 1px 2px/.1 shadow already says "secondary". */
const MARKUP = `<div class="wrap"><div class="pad"><div style="padding:16px">
  <div style="display:flex;gap:8px;margin-bottom:12px">
    <button class="chip">6</button><button class="chip on">7</button><button class="chip">8</button>
  </div>
  <div class="entry-actions" style="display:flex;gap:8px;margin-bottom:10px">
    <button class="btn-cancel">Cancel</button>
    <button class="btn-record">Record Take</button>
  </div>
  <button class="btn-new" style="width:100%;margin-bottom:8px">New Game</button>
  <button class="btn-add" style="width:100%;margin-bottom:8px">Set Up 6 Players</button>
  <button class="btn-danger" style="width:100%;margin-bottom:12px">End Tournament</button>
  <button class="sheet-btn primary disp" style="width:100%">Share Join Code</button>
</div></div></div>`;

const RAISED = ".btn-record,.btn-new,.btn-add,.btn-danger,.sheet-btn.primary,.chip.on";
/* Restates the shipped stack with different inner values. The outer
   0 1px 2px rgba(0,0,0,.25) is the lift and is constant in every row -- only the
   two inset lips move, which is the whole question. */
const bevel = (hi, lo, px) =>
  `${RAISED}{box-shadow:inset 0 ${px} 0 ${hi}, inset 0 -${px} 0 ${lo}, 0 1px 2px rgba(0,0,0,.25)}`;

const VARIANTS = [
  { g: "How much lip does a raised control want? (judge at phone scale)",
    t: "no bevel — flat fill and a drop shadow  (before this change)",
    css: `${RAISED}{box-shadow:0 1px 2px rgba(0,0,0,.25)}` },
  { g: "How much lip does a raised control want? (judge at phone scale)",
    t: "22% / 18%  (rejected: reads at 3x, imperceptible on an actual phone — this shipped for one commit)",
    css: bevel("color-mix(in srgb, var(--cream) 22%, transparent)",
               "color-mix(in srgb, var(--ink) 18%, transparent)", "1px") },
  { g: "How much lip does a raised control want? (judge at phone scale)",
    t: "32% / 26%  (SHIPPED — registers at device scale without becoming a band)", css: `` },
  { g: "How much lip does a raised control want? (judge at phone scale)",
    t: "45% / 36%  (rejected on weight alone — note it does NOT touch the label, which is the reason you would expect)",
    css: bevel("color-mix(in srgb, var(--cream) 45%, transparent)",
               "color-mix(in srgb, var(--ink) 36%, transparent)", "1px") },
  { g: "How much lip does a raised control want? (judge at phone scale)",
    t: "key-cap — 55% / 45%, 2px  (rejected: works, but belongs to a glossier product than a baize scorepad)",
    css: bevel("color-mix(in srgb, var(--cream) 55%, transparent)",
               "color-mix(in srgb, var(--ink) 45%, transparent)", "2px") },

  { g: "Warm or neutral?",
    t: "warm — mixed from --cream and --ink  (SHIPPED)", css: `` },
  { g: "Warm or neutral?",
    t: "neutral — the same alphas as plain white and black  (rejected: cools the brass and the red)",
    css: bevel("rgba(255,255,255,.32)", "rgba(0,0,0,.26)", "1px") },
];

const THEMES = [
  { k: "aubergine", l: "Dark" },
  { k: "aubergine-light", l: "Light" },
];

/* index.html's CSS comments contain "</scr"+"ipt>", which would terminate the
   embedding block. Escaping "<" is the standard mitigation. */
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003C");

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SomeRSet — how much bevel?</title>
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
  .panel{flex:0 0 390px;max-width:100%;min-width:0}
  .panel .lbl{font-size:11px;color:#8E8476;margin:0 0 4px}
  /* 390px wide and unscaled on purpose — see the header. A scaled frame
     makes a 1px bevel look like a decision when it is a no-op. */
  .panel iframe{width:100%;height:400px;border:0;display:block;border-radius:9px;border:1px solid #332D3D}
  @media(max-width:560px){.lede{font-size:13px}}
</style></head><body>
<div class="pad">
  <h1 class="pt">How much bevel does a raised control want?</h1>
  <p class="lede">Real markup, real CSS. Frames are 390px wide and <strong>unscaled</strong> — do not zoom this page to judge it, which is how the first attempt shipped a bevel that was invisible on a phone. The outer lift (<code>0 1px 2px rgba(0,0,0,.25)</code>) is constant in every row; only the two inset lips move. <code>Cancel</code> is in each frame on purpose: the bevel deliberately does <em>not</em> reach it, and a secondary control still has to read as secondary next to a beveled primary.</p>
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

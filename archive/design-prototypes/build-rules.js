"use strict";
/**
 * How heavy should a row separator be? -> out/rules.html
 *
 * --cream-shade does two jobs. As a FILL it is right and 1.14:1 is the point --
 * pressed states, disabled buttons, the score-bar track, the pending-deal row,
 * the championship badge. As a 1px SEPARATOR it is the same 1.14, and a hairline
 * at that ratio is gone on a phone: the deal list, the history groups, the stats
 * rank rows and tile grid all separate on a line you cannot actually see.
 *
 * Same shape as the brass problem one commit earlier -- one token, two jobs, and
 * only one of them needs the contrast.
 *
 * The weight is bounded on both sides, which is what makes it decidable:
 *
 *                        aubergine  aubergine-light   dark   light
 *   --cream-shade           1.14         1.14         1.15    1.16   <- too weak
 *   --rule                  1.96         1.96         1.88    2.18   <- too strong
 *
 * --rule is not free to borrow: it draws the divider under the totals, the 2px
 * top of the entry pane, the sync and match bars, the seat rules. Those are the
 * app's structural divisions, and a deal row is not one of them. Matching them
 * would flatten two levels of hierarchy into one.
 *
 * So the separator wants to land between, and derive from --rule rather than
 * invent a tone: mixed toward the paper it stays in each theme's own hue family
 * for free, including Classic Light's, where --rule is a duller olive-tan than
 * the other three. One :root declaration covers every theme because both
 * operands are already per-theme -- custom properties substitute at the point of
 * use, so var(--rule) inside --rule-soft resolves against whatever theme is on
 * the html element.
 *
 * SHIPPED: 60%, measuring 1.44-1.55. The ladder either side is kept because the
 * choice is a weight, and a weight is only legible next to the weights it beat.
 * The ink-derived row is kept for a different reason: it is the conventional
 * answer (neutral grey hairline) and it is the one that looks wrong here, going
 * cold against a warm pad the moment it is heavy enough to see.
 *
 *   node archive/design-prototypes/build-rules.js
 *   node archive/design-prototypes/serve.js   # then open /rules.html
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const DEST = path.join(OUT, "rules.html");

const APP = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
/* Anchor on the <style> tag alone on its own line; a plain indexOf() finds the
   words "<style>" in a comment first and silently drops :root. See build-press.js. */
const STYLE_AT = APP.search(/^<style>$/m);
if (STYLE_AT < 0) throw new Error("no <style> element found in index.html");
const CSS = APP.slice(STYLE_AT + 7, APP.indexOf("</style>", STYLE_AT));
if (!/:root\s*\{/.test(CSS)) throw new Error("extracted CSS has no :root block");

/* The totals block is in every frame on purpose: its border-bottom is --rule,
   the weight the separators must stay under. A row of separators judged on its
   own just gets darker until you can see it; judged under the divider it is
   supposed to be quieter than, there is a right answer. The pending row is here
   too -- it is --cream-shade as a FILL, the job the token keeps. */
const deal = (a, b, who, dlr, cls) => `
<div class="deal-row${cls ? " " + cls : ""}">
  <span class="deal-sc">${a}</span><span class="deal-sc">${b}</span>
  <span class="deal-bidder" style="flex:1;text-align:center">${who}</span>
  <span class="deal-dealer">${dlr}</span>
</div>`;

const MARKUP = `<div class="wrap"><div class="pad">
  <div class="totals">
    <div class="team" style="grid-column:1">
      <div class="team-name team-name-ro disp"><span class="tn-a">Keith&nbsp;&amp;</span><span class="tn-b"> Sam</span></div>
      <div class="score mono" style="color:var(--ink)">42</div>
      <div class="track"><span style="width:76%; background:var(--plum);"></span></div>
    </div>
    <div class="divider" style="grid-column:2"></div>
    <div class="team" style="grid-column:3">
      <div class="team-name team-name-ro disp"><span class="tn-a">Dana&nbsp;&amp;</span><span class="tn-b"> Priya</span></div>
      <div class="score mono" style="color:var(--ink)">31</div>
      <div class="track"><span style="width:56%; background:var(--rule);"></span></div>
    </div>
  </div>
  <div class="deal-list">
    ${deal(9, 5, "Keith bid 7", "Keith")}
    ${deal(10, 6, "Dana bid 6", "Dana")}
    ${deal(10, 4, "Marcus bid 8", "Marcus")}
    ${deal(7, 7, "Priya bid 6", "Priya", "pending")}
  </div>
</div></div>`;

const sep = (v) => `[data-theme]{--rule-soft:${v}}`;
const RULE_MIX = (p) => `color-mix(in srgb, var(--rule) ${p}%, var(--cream))`;
const INK_MIX = (p) => `color-mix(in srgb, var(--ink-soft) ${p}%, var(--cream))`;

/* `css: ""` means "as index.html currently ships", so a shipped row renders the
   real file rather than a copy of it that can rot. */
const VARIANTS = [
  { g: "How heavy is a row separator?",
    t: "--cream-shade  (before this change — 1.14:1, and it does the fill job in the same frame)",
    css: sep("var(--cream-shade)") },
  { g: "How heavy is a row separator?",
    t: "--rule mixed 50% toward the paper  (1.35–1.43)", css: sep(RULE_MIX(50)) },
  { g: "How heavy is a row separator?",
    t: "--rule mixed 60%  (SHIPPED — 1.44–1.55)", css: `` },
  { g: "How heavy is a row separator?",
    t: "--rule mixed 70%  (1.54–1.68 — starts competing with the divider above it)", css: sep(RULE_MIX(70)) },
  { g: "How heavy is a row separator?",
    t: "--rule outright  (rejected: identical to the totals divider, two hierarchy levels collapse into one)",
    css: sep("var(--rule)") },

  { g: "The conventional answer, for comparison",
    t: "--ink-soft mixed 26% — a neutral grey hairline at a matched 1.38–1.42  (rejected: cold on a warm pad)",
    css: sep(INK_MIX(26)) },
  { g: "The conventional answer, for comparison",
    t: "--rule mixed 60%, same weight, the paper's own hue  (SHIPPED)", css: `` },
];

const THEMES = [
  { k: "aubergine", l: "Dark" },
  { k: "aubergine-light", l: "Light" },
  { k: "light", l: "Classic Light — duller --rule" },
];

/* index.html's CSS comments contain "</scr"+"ipt>", which would terminate the
   embedding block. Escaping "<" is the standard mitigation. */
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003C");

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SomeRSet — how heavy is a row separator?</title>
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
  .panel{flex:1 1 300px;min-width:0}
  .panel .lbl{font-size:11px;color:#8E8476;margin:0 0 4px}
  .panel iframe{width:100%;height:390px;border:0;display:block;border-radius:9px;border:1px solid #332D3D}
  @media(max-width:560px){.lede{font-size:13px}}
</style></head><body>
<div class="pad">
  <h1 class="pt">How heavy is a row separator?</h1>
  <p class="lede">Real markup, real CSS. Bounded on both sides: <code>--cream-shade</code> at <strong>1.14</strong> is invisible, <code>--rule</code> at <strong>~2.0</strong> is the divider under the totals in every frame — a deal row must stay quieter than that. The last row of each list is <code>.pending</code>, which is <code>--cream-shade</code> doing the fill job it keeps.</p>
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

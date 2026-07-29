"use strict";
/**
 * SCOREPAD subtitle balance -> out/subhead.html
 *
 * Ten treatments of the line under the wordmark, on both grounds: a tracking
 * ladder, a rule-weight ladder, and two combinations. Uses the app's real
 * markup and real CSS, with the letterpress already applied, so what you are
 * comparing is only the balance between the word and its flanking rules.
 *
 * SHIPPED: .26em tracking, rules at 65% colour and 26px. See the .subtitle
 * block in index.html. The ladders are kept because the two rejected ends are
 * informative -- .16em stops being a display line at all, and dropping the
 * rules entirely is cleaner but loses the title-page quality that ties the
 * masthead to the app's paper metaphor.
 *
 *   node archive/design-prototypes/build-subhead.js
 *   node archive/design-prototypes/serve.js   # then open /subhead.html
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const DEST = path.join(OUT, "subhead.html");

const APP = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const CSS = APP.slice(APP.indexOf("<style>") + 7, APP.indexOf("</style>"));

const MARKUP = `<div class="wrap"><header style="margin:0">
  <p class="subtitle disp"><span class="rule-dash"></span>Scorepad<span class="rule-dash"></span></p>
</header></div>`;

// Rules at reduced weight: the fill lightens, and the pressed highlight/shadow
// lighten with it, or the box-shadow ends up louder than the line it edges.
const softRule = (pct, w) => `
.subtitle .rule-dash { width:${w}px;
  background: color-mix(in srgb, currentColor ${pct}%, transparent);
  box-shadow: 0 -1px 1px color-mix(in srgb, var(--mast-lo) ${pct}%, transparent),
              0 1px 0 color-mix(in srgb, var(--mast-hi) ${pct}%, transparent); }`;

// `css: ""` means "as index.html currently ships", so the baseline row always
// reflects the real file rather than a copy of it that can rot.
const VARIANTS = [
  { g: "Tracking — rules as shipped", t: ".26em  (shipped)", css: `` },
  { g: "Tracking — rules as shipped", t: ".35em  (the original)", css: `.subtitle{letter-spacing:.35em}` },
  { g: "Tracking — rules as shipped", t: ".22em", css: `.subtitle{letter-spacing:.22em}` },
  { g: "Tracking — rules as shipped", t: ".16em  (too far)", css: `.subtitle{letter-spacing:.16em}` },

  { g: "Rule weight — tracking as shipped", t: "65% colour, 26px  (shipped)", css: `` },
  { g: "Rule weight — tracking as shipped", t: "full colour, 30px  (the original)",
    css: `.subtitle .rule-dash{width:30px;background:currentColor;
           box-shadow:0 -1px 1px var(--mast-lo),0 1px 0 var(--mast-hi)}` },
  { g: "Rule weight — tracking as shipped", t: "55% colour, 22px", css: softRule(55, 22) },
  { g: "Rule weight — tracking as shipped", t: "no rules at all",
    css: `.subtitle .rule-dash{display:none}` },

  { g: "The other candidate", t: ".22em + 55% colour, 22px rules",
    css: `.subtitle{letter-spacing:.22em}` + softRule(55, 22) },
  { g: "The other candidate", t: ".35em + full colour, 30px  (before any of this)",
    css: `.subtitle{letter-spacing:.35em;text-shadow:none}
          .subtitle .rule-dash{width:30px;background:currentColor;box-shadow:none}` },
];

const THEMES = [{ k: "aubergine", l: "Dark" }, { k: "aubergine-light", l: "Light" }];

/* index.html's CSS comments mention "</scr"+"ipt>", which would terminate the
   embedding <script> block. Escaping "<" is the standard mitigation. */
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003C");

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SomeRSet — SCOREPAD subtitle</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box} html,body{margin:0}
  body{font:15px/1.5 -apple-system,system-ui,sans-serif;background:#121016;color:#EDE6DA;
       padding:0 0 50px;-webkit-text-size-adjust:100%}
  .pad{padding:20px max(16px,env(safe-area-inset-left)) 0}
  h1.pt{font-size:19px;margin:0 0 6px;font-weight:650}
  .lede{margin:0;color:#A79C8D;font-size:14px;max-width:70ch}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8E8476;
     margin:26px 0 0;padding:16px max(16px,env(safe-area-inset-left)) 0;border-top:1px solid #2A2532}
  .row{padding:10px max(16px,env(safe-area-inset-left)) 0}
  .cap{margin:0 0 6px;font-size:13px;font-weight:600;color:#F3ECDF}
  .pair{display:flex;gap:12px;flex-wrap:wrap}
  .panel{flex:1 1 300px;min-width:0}
  .panel iframe{width:100%;height:62px;border:0;display:block;border-radius:9px;border:1px solid #332D3D}
  @media(max-width:560px){.lede{font-size:13px}}
</style></head><body>
<div class="pad">
  <h1 class="pt">SCOREPAD &mdash; tracking &amp; rule weight</h1>
  <p class="lede">Real markup, real CSS, letterpress applied. Dark left, light right. Rows marked <em>shipped</em> render whatever <code>index.html</code> currently says, so they can't drift from the app.</p>
</div>
<div id="out"></div>
<script>
const APP_CSS=${js(CSS)}, MARKUP=${js(MARKUP)}, VARIANTS=${js(VARIANTS)}, THEMES=${js(THEMES)};
function srcdoc(theme,css){
  return '<!doctype html><html data-theme="'+theme+'"><head><meta charset="utf-8">'
    +'<style>'+APP_CSS+css+'body{padding:18px 12px;min-height:0}</style>'
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
    const f=document.createElement("iframe"); f.setAttribute("scrolling","no");
    f.srcdoc=srcdoc(t.k,v.css); panel.appendChild(f); pair.appendChild(panel);
  }
  row.appendChild(pair); out.appendChild(row);
}
</script></body></html>`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(DEST, page);
console.log("wrote " + DEST + "  (" + (page.length / 1024).toFixed(0) + "KB)");

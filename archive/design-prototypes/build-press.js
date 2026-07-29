"use strict";
/**
 * Should the letterpress spread past the masthead? -> out/press.html
 *
 * The h1 and .subtitle sit on the FELT (--mast on --felt). The scoreboard sits
 * on the PAD (--ink on --cream). Across the two live themes those grounds
 * behave completely differently:
 *
 *              aubergine   aubergine-light
 *   --felt     #2E1B3A     #E8E1CE          <- inverts
 *   --cream    #F6EEDC     #F6EEDC          <- IDENTICAL
 *   --ink      #2C2620     #2C2620          <- IDENTICAL
 *
 * aubergine-light is a verbatim token-for-token copy of aubergine except for
 * --felt/--felt-deep and the --mast-* family (see the comment above the block
 * in index.html). So the pad is literally the same surface in both themes --
 * only the felt flips.
 *
 * That is why --mast-hi/--mast-lo cannot be reused below the masthead. They are
 * per-theme *because the felt flips*; applied to the pad they would press the
 * very same cream two different ways depending on a setting that does not touch
 * it -- rgba(0,0,0,.62) black on dark, rgba(70,52,30,.34) warm on light, same
 * pixels underneath. Row 2 renders exactly that, so the incoherence is visible
 * rather than asserted.
 *
 * The fair test is a pad-specific pair, and since the pad ground is constant it
 * needs exactly ONE pair rather than one per theme -- the opposite of the
 * masthead's situation.
 *
 * SHIPPED: the 48px .score only, via --press-lo/--press-hi in :root. Team names
 * were tried and rejected -- at 17px the impression stops registering and only
 * costs stem definition, which is the worst of both. Those rows are kept
 * because "it looks fine, it just does nothing" is the finding, and that is
 * only legible next to the size that works.
 *
 *   node archive/design-prototypes/build-press.js
 *   node archive/design-prototypes/serve.js   # then open /press.html
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const DEST = path.join(OUT, "press.html");

const APP = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
/* Anchor on the <style> tag alone on its own line. index.html also mentions
   "<style>" inside a comment in the early inline theme script, and a plain
   indexOf() finds that prose first -- the slice then starts mid-script and the
   CSS parser discards everything up to the first selector it can resync on,
   silently dropping the whole :root block (radius scale, font stacks, --plum,
   --press-*). It looked fine for a long time because the tokens these pages
   exercise mostly live in [data-theme] blocks, and an undefined
   var(--font-display) happens to fall back to a serif. The assertion below is
   the actual guard: a wrong slice must fail loudly, not render a lie. */
const STYLE_AT = APP.search(/^<style>$/m);
if (STYLE_AT < 0) throw new Error("no <style> element found in index.html");
const CSS = APP.slice(STYLE_AT + 7, APP.indexOf("</style>", STYLE_AT));
if (!/:root\s*\{/.test(CSS)) throw new Error("extracted CSS has no :root block");

/* Faithful to renderScorePad(): .team-name-ro splits "A & B" into two spans so
   the name can wrap between them, and .score carries .mono plus an inline
   colour. Long second team on purpose -- wrapping is the normal case, and it is
   where a shadow on small text does its damage. */
const team = (name, partner, score, pct, fill) => `
<div class="team" style="grid-column:${fill === "var(--plum)" ? 1 : 3}">
  <div class="team-name team-name-ro disp"><span class="tn-a">${name}&nbsp;&amp;</span><span class="tn-b"> ${partner}</span></div>
  <div class="score mono" style="color:var(--ink)">${score}</div>
  <div class="track"><span style="width:${pct}%; background:${fill};"></span></div>
</div>`;

const MARKUP = `<div class="wrap"><div class="pad"><div class="totals">
${team("Keith", "Sam", 42, 76, "var(--plum)")}
<div class="divider" style="grid-column:2"></div>
${team("Marguerite", "Christopher", 31, 56, "var(--rule)")}
</div></div></div>`;

/* Deboss on paper: light reads as coming from above, so the upper inner wall of
   the impression falls into shadow and the lower lip catches the light -- dark
   offset up, light offset down, same logic as the masthead. What changes is the
   palette. The shadow has to be warm brown rather than black or the ink goes
   grey and cold against cream, and the highlight has to be near-opaque white or
   it does nothing on a light ground. These sit close to aubergine-light's mast
   pair, which is the point -- that pair was tuned for a light ground, and the
   pad is a light ground in BOTH themes. One pair covers the whole app. */
const press = (sel, lo, hi, blur) =>
  `${sel}{text-shadow:0 -1px ${blur} ${lo}, 0 1px 0 ${hi}}`;

/* `css: ""` means "as index.html currently ships", so the shipped rows always
   reflect the real file rather than a copy of it that can rot. The pad pair is
   read back out of the app as var(--press-*) for the same reason. */
const LO = "var(--press-lo)";
const HI = "var(--press-hi)";

const VARIANTS = [
  { g: "The 48px score — the one candidate with the scale for it",
    t: "before this change, no press", css: `.score{text-shadow:none}` },
  { g: "The 48px score — the one candidate with the scale for it",
    t: "reusing --mast-hi/--mast-lo  (wrong by construction — see dark)",
    css: press(".score", "var(--mast-lo)", "var(--mast-hi)", "1px") },
  { g: "The 48px score — the one candidate with the scale for it",
    t: "pad-tuned press  (SHIPPED)", css: `` },
  { g: "The 48px score — the one candidate with the scale for it",
    t: "pad-tuned press, heavier — .45 alpha  (rejected: reads as drop shadow)",
    css: press(".score", "rgba(70,52,30,.45)", HI, "1px") },

  { g: "Spreading it to the 17px team names — a third of the size",
    t: "team names left alone  (SHIPPED)", css: `` },
  { g: "Spreading it to the 17px team names — a third of the size",
    t: "team names pressed too, identical values  (rejected)",
    css: press(".team-name", LO, HI, "1px") },
  { g: "Spreading it to the 17px team names — a third of the size",
    t: "team names pressed, sub-pixel offset  (rejected)",
    css: `.team-name{text-shadow:0 -.5px .5px ${LO}, 0 .5px 0 ${HI}}` },
];

const THEMES = [{ k: "aubergine", l: "Dark" }, { k: "aubergine-light", l: "Light" }];

/* index.html's CSS comments mention "</scr"+"ipt>", which would terminate the
   embedding <script> block. Escaping "<" is the standard mitigation. */
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003C");

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SomeRSet — letterpress past the masthead?</title>
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
  .panel{flex:1 1 320px;min-width:0}
  .panel iframe{width:100%;height:210px;border:0;display:block;border-radius:9px;border:1px solid #332D3D}
  @media(max-width:560px){.lede{font-size:13px}}
</style></head><body>
<div class="pad">
  <h1 class="pt">Letterpress past the masthead?</h1>
  <p class="lede">Real markup, real CSS. Dark left, light right. The masthead presses <code>--mast</code> into the <em>felt</em>, which inverts between themes. The scoreboard sits on the <em>pad</em>, whose <code>--cream</code> and <code>--ink</code> are <strong>byte-identical</strong> in both — so the two panels of every row below have the same ground, and any row where they diverge is the token pair being wrong, not the theme.</p>
</div>
<div id="out"></div>
<script>
const APP_CSS=${js(CSS)}, MARKUP=${js(MARKUP)}, VARIANTS=${js(VARIANTS)}, THEMES=${js(THEMES)};
function srcdoc(theme,css){
  return '<!doctype html><html data-theme="'+theme+'"><head><meta charset="utf-8">'
    +'<style>'+APP_CSS+css+'body{padding:14px 12px;min-height:0}.wrap{margin:0 auto}</style>'
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

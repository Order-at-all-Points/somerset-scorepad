"use strict";
/**
 * How does the pad read as paper when the felt stops being dark? -> out/pad.html
 *
 * The pad is cream paper lying on felt. In the dark themes that reads on tone
 * alone -- --cream on --felt measures 13.6:1 (aubergine) and 11.7:1 (dark), so
 * the sheet's edge needs no help and gets none. The dashed seam floating 6px off
 * it is decorative on top of an already-obvious boundary, and it is tinted with
 * the paper's own colour (cream at 40%) because on dark felt a pale line is what
 * a stitch looks like.
 *
 * Both light themes share --felt:#E8E1CE, and against that same cream the pad
 * measures 1.13:1 (aubergine-light) / 1.26:1 (light) -- invisible -- with the
 * cream-tinted seam at 1.05 / 1.10, which is a pale line drawn on a pale ground.
 * The paper metaphor does not render at all: the app is one flat beige field
 * from masthead to OPTIONS pill.
 *
 * Neither tone can move to fix it:
 *   --cream  is byte-identical across aubergine/aubergine-light by construction
 *            (see the block comment in index.html) and is the ground every piece
 *            of text in the app is tuned against.
 *   --felt   carries --mast-soft:#675D4C at ~4.96:1 and the masthead's
 *            --mast-lo/--mast-hi letterpress, all tuned to this exact tone.
 * Darkening the felt to make the paper float also stops the theme being light.
 *
 * So the edge has to be drawn rather than implied -- which is what paper on a
 * pale table actually looks like: you read the cut edge and the shadow under it,
 * not a change of colour. That makes the edge treatment a per-theme concern for
 * the same reason --mast-* is: its contrast partner is the FELT, and the felt
 * inverts. Hence --pad-edge/--pad-seam in the theme blocks rather than :root,
 * the mirror image of --press-* (pad-on-pad, so one pair covers every theme).
 *
 * Values are solved against --felt-deep, not --felt: body is a radial gradient
 * from felt at 18% to felt-deep at the bottom, so the darker end is where a warm
 * line has least to work with. Quoted ratios below are the worst case.
 *
 * SHIPPED: --pad-edge at .76 alpha (4.5:1) and --pad-seam at .62 (3.2:1) on the
 * light themes; dark themes keep a transparent edge and the cream seam they
 * already had. The rejected rows are kept because "the ring alone is enough" and
 * "a heavier shadow instead" are both plausible until you see them next to each
 * other at phone width.
 *
 *   node archive/design-prototypes/build-pad.js
 *   node archive/design-prototypes/serve.js   # then open /pad.html
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const DEST = path.join(OUT, "pad.html");

const APP = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
/* Anchor on the <style> tag alone on its own line -- index.html mentions
   "<style>" in a comment inside the early inline theme script, and a plain
   indexOf() finds that prose first, silently dropping the whole :root block.
   See the same guard in build-press.js; the assertion is the real protection. */
const STYLE_AT = APP.search(/^<style>$/m);
if (STYLE_AT < 0) throw new Error("no <style> element found in index.html");
const CSS = APP.slice(STYLE_AT + 7, APP.indexOf("</style>", STYLE_AT));
if (!/:root\s*\{/.test(CSS)) throw new Error("extracted CSS has no :root block");

/* Enough pad to own an edge on all four sides, plus the OPTIONS pill so the
   felt below it is real rather than a margin. Faithful to renderScorePad():
   .team-name-ro splits "A & B" so the name can wrap, .score carries .mono. */
const team = (name, partner, score, pct, fill) => `
<div class="team" style="grid-column:${fill === "var(--plum)" ? 1 : 3}">
  <div class="team-name team-name-ro disp"><span class="tn-a">${name}&nbsp;&amp;</span><span class="tn-b"> ${partner}</span></div>
  <div class="score mono" style="color:var(--ink)">${score}</div>
  <div class="track"><span style="width:${pct}%; background:${fill};"></span></div>
</div>`;

const MARKUP = `<div class="wrap"><div class="pad"><div class="totals">
${team("Keith", "Sam", 42, 76, "var(--plum)")}
<div class="divider" style="grid-column:2"></div>
${team("Dana", "Priya", 31, 56, "var(--rule)")}
</div></div>
<div style="text-align:center;padding:18px 0 4px"><button class="settings-toggle">Options</button></div>
</div>`;

/* Warm brown, the same base as light --mast-lo -- a neutral line goes grey and
   cold against this felt exactly as it does against the cream. Alphas are
   bisected to a target ratio over --felt-deep; see the header. */
const BROWN = (a) => `rgba(70,52,30,${a})`;
const edge = (a) => `[data-theme]{--pad-edge:${a}}`;
const seam = (a) => `[data-theme]{--pad-seam:${a}}`;

/* `css: ""` means "as index.html currently ships", so a shipped row always
   renders the real file rather than a copy of it that can rot. */
const VARIANTS = [
  { g: "The paper's edge — what tells you where the sheet stops",
    t: "no edge, tone alone  (before this change — the dark panel is the whole argument)",
    css: edge("transparent") + seam("color-mix(in srgb, var(--cream) 40%, transparent)") },
  { g: "The paper's edge — what tells you where the sheet stops",
    t: "hairline ring, 3.2:1  (rejected: matches the seam's weight, so the sheet has two equal outlines)",
    css: edge(BROWN(".619")) },
  { g: "The paper's edge — what tells you where the sheet stops",
    t: "hairline ring, 4.0:1", css: edge(BROWN(".714")) },
  { g: "The paper's edge — what tells you where the sheet stops",
    t: "hairline ring, 4.5:1  (SHIPPED)", css: `` },
  { g: "The paper's edge — what tells you where the sheet stops",
    t: "no ring, heavier cast shadow instead  (rejected: reads as a hover state, and blurs the edge it is meant to define)",
    css: edge("transparent") +
      `.pad{box-shadow:0 2px 4px rgba(70,52,30,.28), 0 14px 34px rgba(70,52,30,.42)}` },

  { g: "The stitched seam — decorative, and it has to stay subordinate",
    t: "cream at 40%, as the dark themes tint it  (before this change: 1.05:1 on light felt)",
    css: seam("color-mix(in srgb, var(--cream) 40%, transparent)") },
  { g: "The stitched seam — decorative, and it has to stay subordinate",
    t: "warm at 3.2:1, matching what the seam measures on dark felt  (SHIPPED)", css: `` },
  { g: "The stitched seam — decorative, and it has to stay subordinate",
    t: "warm at 4.5:1, same weight as the ring  (rejected: stitching louder than the sheet)",
    css: seam(BROWN(".764")) },
];

/* Dark first as the control -- it is the look the light themes are failing to
   produce, and every row should be read against it. Classic Light is hidden
   from the Display sheet but still pinned for anyone who chose it before
   2026-07-07, and it shares the same felt, so it is fixed and shown too. */
const THEMES = [
  { k: "aubergine", l: "Dark — the control, unchanged" },
  { k: "aubergine-light", l: "Light" },
  { k: "light", l: "Classic Light" },
];

/* index.html's CSS comments mention "</scr"+"ipt>", which would terminate the
   embedding <script> block. Escaping "<" is the standard mitigation. */
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003C");

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SomeRSet — the pad's edge on light felt</title>
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
  .panel iframe{width:100%;height:250px;border:0;display:block;border-radius:9px;border:1px solid #332D3D}
  @media(max-width:560px){.lede{font-size:13px}}
</style></head><body>
<div class="pad">
  <h1 class="pt">The pad's edge on light felt</h1>
  <p class="lede">Real markup, real CSS. The pad is cream paper on felt; on dark felt that reads on tone alone (<code>13.6:1</code>), on light felt it measures <code>1.13:1</code> and the sheet disappears. Neither <code>--cream</code> nor <code>--felt</code> can move — see the header of <code>build-pad.js</code> — so the edge is drawn instead. Ratios are worst-case, against <code>--felt-deep</code> at the bottom of the body gradient.</p>
</div>
<div id="out"></div>
<script>
const APP_CSS=${js(CSS)}, MARKUP=${js(MARKUP)}, VARIANTS=${js(VARIANTS)}, THEMES=${js(THEMES)};
function srcdoc(theme,css){
  return '<!doctype html><html data-theme="'+theme+'"><head><meta charset="utf-8">'
    +'<style>'+APP_CSS+css+'body{padding:16px 12px;min-height:100vh}.wrap{margin:0 auto}</style>'
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

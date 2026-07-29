"use strict";
/**
 * Tactile-masthead comparison page -> out/masthead.html
 *
 * Six treatments of the SOME-R-SET wordmark, each rendered with the app's real
 * <header> markup and real CSS, on BOTH grounds. Showing both is the point: the
 * only way a depth effect fails is by quietly assuming a dark background, and
 * side-by-side is the cheapest way to catch that.
 *
 * B (Letterpress) shipped — see the h1 comment in index.html. The rest are kept
 * here so the comparison can be re-run rather than rebuilt from memory.
 *
 *   node archive/design-prototypes/build-masthead.js
 *   node archive/design-prototypes/serve.js   # then open /masthead.html
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const DEST = path.join(OUT, "masthead.html");

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

const HEADER = `<div class="wrap">
  <header>
    <button class="menu-btn" aria-label="Settings">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
    </button>
    <h1 class="disp">SOME-R-SET</h1>
    <p class="eyebrow disp"><span class="rule-dash"></span>Scorepad<span class="rule-dash"></span></p>
  </header>
</div>`;

/* --mast-hi / --mast-lo now ship in index.html (each theme block, beside
   --mast). Only the foil tone is prototype-local, since no shipped treatment
   uses it yet. Re-basing it per theme is not optional: --rule on light felt
   measures 1.73:1, i.e. invisible. */
const TOKENS = `
[data-theme="aubergine"], [data-theme="dark"] {
  --mast-foil-base: var(--rule);
  --mast-foil-dark: color-mix(in srgb, var(--rule) 52%, #000);
  --mast-foil-lite: color-mix(in srgb, var(--rule) 40%, #FFF8E6);
}
[data-theme="aubergine-light"], [data-theme="light"] {
  --mast-foil-base: var(--brass-text);
  --mast-foil-dark: color-mix(in srgb, var(--brass-text) 68%, #000);
  --mast-foil-lite: color-mix(in srgb, var(--brass-text) 55%, #E8C98A);
}
`;

const VARIANTS = [
  { id: "flat", title: "A · Current", note: "flat fill, no depth cues", css: `` },

  { id: "deboss", title: "B · Letterpress  ← SHIPPED", note: "pressed into the felt",
    // Light from above: the upper inner wall of an impression is in shadow, the
    // lower lip catches it. Shadow offset up, highlight down.
    css: `html.v-deboss h1 { text-shadow: 0 -1px 1px var(--mast-lo), 0 1px 0 var(--mast-hi); }` },

  { id: "emboss", title: "C · Embossed", note: "raised off the felt",
    css: `html.v-emboss h1 { text-shadow: 0 -1px 0 var(--mast-hi), 0 1px 0 var(--mast-lo), 0 3px 5px var(--mast-lo); }` },

  { id: "foil", title: "D · Gold foil", note: "metallic leaf, flat to the surface",
    // background-clip:text makes the glyphs transparent, so a text-shadow would
    // show straight through them. The shadow has to come from filter:drop-shadow,
    // which follows rendered alpha instead.
    css: `
html.v-foil h1 {
  background-image: linear-gradient(176deg,
    var(--mast-foil-dark) 0%, var(--mast-foil-base) 30%, var(--mast-foil-lite) 49%,
    var(--mast-foil-base) 60%, var(--mast-foil-dark) 100%);
  -webkit-background-clip: text; background-clip: text;
  color: transparent; -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 1px 0 var(--mast-lo)) drop-shadow(0 2px 4px var(--mast-lo));
}` },

  { id: "foilpress", title: "E · Foil, blocked in", note: "leaf sitting in a pressed impression",
    // How a bound cover actually works: the die presses the board, then foil is
    // laid into the impression.
    css: `
html.v-foilpress h1 {
  background-image: linear-gradient(176deg,
    var(--mast-foil-dark) 0%, var(--mast-foil-base) 32%, var(--mast-foil-lite) 50%,
    var(--mast-foil-base) 62%, var(--mast-foil-dark) 100%);
  -webkit-background-clip: text; background-clip: text;
  color: transparent; -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 -1px 0 var(--mast-lo)) drop-shadow(0 1px 0 var(--mast-hi));
}` },

  { id: "engrave", title: "F · Deep engrave", note: "cut in, no metal",
    css: `
html.v-engrave h1 {
  color: color-mix(in srgb, var(--mast) 74%, var(--felt));
  text-shadow: 0 -1px 1px var(--mast-lo), 0 1px 0 var(--mast-hi), 0 0 6px var(--mast-lo);
}` },
];

const THEMES = [{ key: "aubergine", label: "Dark" }, { key: "aubergine-light", label: "Light" }];

/* index.html's CSS comments mention "</scr"+"ipt>", which would terminate the
   embedding <script> block. Escaping "<" is the standard mitigation and is
   transparent to JS. */
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003C");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SomeRSet — tactile masthead</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing:border-box; }
  html, body { margin:0; }
  body { font:15px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif;
         background:#121016; color:#EDE6DA; padding:0 0 56px; -webkit-text-size-adjust:100%; }
  .pad { padding:20px max(16px, env(safe-area-inset-left)) 0; }
  h1.pt { font-size:19px; margin:0 0 6px; font-weight:650; letter-spacing:-.01em; }
  .lede { margin:0; color:#A79C8D; font-size:14px; max-width:74ch; }
  .row { border-top:1px solid #2A2532; margin-top:22px; padding:16px max(16px, env(safe-area-inset-left)) 0; }
  .cap { margin:0 0 10px; font-size:14px; font-weight:650; color:#F3ECDF; }
  .cap small { display:block; font-weight:400; color:#8E8476; font-size:12.5px; margin-top:2px; }
  .pair { display:flex; gap:14px; flex-wrap:wrap; }
  .panel { flex:1 1 300px; min-width:0; }
  .panel .tag { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#6F6659; margin:0 0 5px; }
  .panel iframe { width:100%; height:150px; border:0; display:block;
                  border-radius:12px; border:1px solid #332D3D; background:#000; }
  .foot { margin-top:34px; padding:18px max(16px, env(safe-area-inset-left)) 0;
          border-top:1px solid #2A2532; color:#8E8476; font-size:13px; max-width:78ch; }
  .foot code { background:#1E1A26; padding:1px 5px; border-radius:4px; font-size:12px; }
  @media (max-width:560px){ h1.pt{font-size:17px} .lede{font-size:13px} .panel iframe{height:140px} }
</style>
</head>
<body>
<div class="pad">
  <h1 class="pt">Tactile masthead &mdash; six treatments</h1>
  <p class="lede">The real <code>&lt;header&gt;</code> markup and the app's real CSS, on real felt. Each treatment on <strong>both</strong> grounds, because the only way these fail is by assuming a dark one.</p>
</div>
<div id="out"></div>
<div class="foot">
  <p>All six are pure CSS on the existing <code>h1</code> &mdash; no images, no extra markup, no build step. <strong>B shipped.</strong> The light/shadow strengths are per-theme tokens in <code>index.html</code>; the foil tone is defined in this generator only.</p>
</div>
<script>
const APP_CSS = ${js(CSS)};
const TOKENS = ${js(TOKENS)};
const VCSS = ${js(VARIANTS.map((v) => v.css).join("\n"))};
const HEADER = ${js(HEADER)};
const VARIANTS = ${js(VARIANTS.map((v) => ({ id: v.id, title: v.title, note: v.note })))};
const THEMES = ${js(THEMES)};

function srcdoc(theme, id) {
  return '<!doctype html><html data-theme="' + theme + '" class="v-' + id + '">'
    + '<head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>' + APP_CSS + TOKENS + VCSS
    + 'body{padding:22px 12px 20px;min-height:0}header{margin-bottom:4px}'
    + '</style></head><body>' + HEADER + '</body></html>';
}

const out = document.getElementById("out");
for (const v of VARIANTS) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = '<p class="cap">' + v.title + '<small>' + v.note + '</small></p>';
  const pair = document.createElement("div");
  pair.className = "pair";
  for (const t of THEMES) {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = '<p class="tag">' + t.label + '</p>';
    const f = document.createElement("iframe");
    f.setAttribute("scrolling", "no");
    f.srcdoc = srcdoc(t.key, v.id);
    panel.appendChild(f);
    pair.appendChild(panel);
  }
  row.appendChild(pair);
  out.appendChild(row);
}
</script>
</body>
</html>`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(DEST, page);
console.log("wrote " + DEST + "  (" + (page.length / 1024).toFixed(0) + "KB)");

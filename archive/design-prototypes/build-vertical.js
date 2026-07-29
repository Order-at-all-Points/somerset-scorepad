"use strict";
/**
 * Vertical-space comparison page -> out/vertical-space.html
 *
 * Five ways to handle the dead felt below short screens, applied to the real
 * captured DOM (out/screens.json, from capture-screens.js) with the app's real
 * CSS. Each frame is an iframe at true device dimensions, so 100dvh, safe-area
 * insets and media queries all resolve exactly as they do on a phone — which
 * variant B depends on entirely.
 *
 * A–D are the original parked set. E was added on revisiting, because the
 * framing that produced A–D was wrong in a way worth writing down.
 *
 * measure-space.js reports dead space per screen and flags any screen whose
 * void GROWS from SE to Pro Max as "shrink-wrapping instead of participating in
 * the viewport". Every short screen does (History-empty 42%->59%, Stats 17->41,
 * Tournament 16->40), and the obvious reading is that they are all the same
 * defect. Look at them and they are not:
 *
 *   Tournament — setup   a COMPLETE card: heading, stepper, primary button, and
 *                        a secondary route out. It ends where it ends.
 *   Stats — 4 players    four rows because there are four players.
 *   History — 1 game     one game because one game has been played.
 *   Game — fresh         a full seat diagram and the primary GO control.
 *
 * Those grow on their own, and the felt under them is the product: the pad is a
 * sheet of paper on a card table, so the table showing is the metaphor working.
 * Stretching a finished card to 100dvh and ruling the remainder tells the user
 * there is more to come when there is not. That is what B does to them.
 *
 * The two screens that ARE broken are broken for a different reason. History and
 * Stats on first run render the full filter chrome — Log/Stats, then All/Today/
 * Standard/Tournament or the four sort chips — wrapped around one grey sentence
 * at `.empty`'s 20px padding. They are not short cards, they are chrome with
 * nothing in it, filtering over a set with no members. And History-empty is the
 * literal first screen a new user sees.
 *
 * So the measurement was answering "which screens are short?" when the question
 * was "which screens look unfinished?" -- a screen can be either without being
 * the other, and dead space turns out to be a poor proxy in both directions.
 * E fixed the two that look unfinished and left the rest alone: no flexed body,
 * no 100dvh, no ruled filler, and no change at all to four of the six screens.
 * On those four it rendered identically to A, which was the argument for it.
 *
 * SHIPPED: E, as .empty-state plus the chip-row gate. B, C and D are kept below
 * because a choice is only legible next to what it beat, and B in particular has
 * to be looked at on the lower three screens to be rejected -- described, it
 * sounds like the obvious fix.
 *
 * E has no row of its own any more. It is in index.html, so `A · Current`
 * renders it from the real file the moment screens.json is recaptured, which is
 * the same convention the other generators follow: a shipped variant renders
 * whatever the app currently says rather than a copy that can rot. If A looks
 * like the old one-line caption, the capture predates the change -- rerun
 * capture-screens.js.
 *
 *   node archive/design-prototypes/capture-screens.js   # first, once
 *   node archive/design-prototypes/build-vertical.js
 *   node archive/design-prototypes/serve.js             # open /vertical-space.html
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const SRC = path.join(OUT, "screens.json");
const DEST = path.join(OUT, "vertical-space.html");

if (!fs.existsSync(SRC)) {
  console.error("Missing " + SRC + "\nRun: node archive/design-prototypes/capture-screens.js");
  process.exit(1);
}

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
const SCREENS = JSON.parse(fs.readFileSync(SRC, "utf8"));

const FILL_CSS = `
/* ===== Variant: fill the pad ===== */
html.v-fill body { display:flex; flex-direction:column; }
/* width:100% is load-bearing. .wrap carries "margin:0 auto", and auto margins in
   the cross axis absorb free space, which disables align-items:stretch — without
   an explicit width the wrap collapses to its content width and the whole app
   narrows. Keeps max-width:480px + auto margins doing the centring as before. */
html.v-fill .wrap { width:100%; flex:1 1 auto; display:flex; flex-direction:column; }
html.v-fill #viewRoot { flex:1 1 auto; display:flex; flex-direction:column; min-height:0; }
html.v-fill #viewRoot > .pad { flex:1 1 auto; display:flex; flex-direction:column; }
/* The unwritten remainder of the sheet: ruled like a real scorepad, so blank
   space reads as "page you haven't filled in yet" rather than "layout ran out". */
html.v-fill .pad-filler {
  flex:1 1 auto; min-height:44px;
  background-image: repeating-linear-gradient(to bottom,
    transparent 0, transparent 31px,
    color-mix(in srgb, var(--ink-soft) 13%, transparent) 31px,
    color-mix(in srgb, var(--ink-soft) 13%, transparent) 32px);
}
/* Real empty state, centred in the sheet instead of one grey sentence. */
html.v-fill .empty-state {
  flex:1 1 auto; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:2px; padding:32px 24px; text-align:center;
  background-image: repeating-linear-gradient(to bottom,
    transparent 0, transparent 31px,
    color-mix(in srgb, var(--ink-soft) 13%, transparent) 31px,
    color-mix(in srgb, var(--ink-soft) 13%, transparent) 32px);
}
html.v-fill .empty-state svg { color:var(--rule); margin-bottom:10px; }
html.v-fill .empty-state h4 { margin:0; font-family:var(--font-display); font-size:20px; font-weight:600; color:var(--ink); }
html.v-fill .empty-state p { margin:4px 0 18px; font-size:13px; color:var(--ink-soft); max-width:24ch; line-height:1.45; }
html.v-fill .empty-state .btn-new { width:auto; padding:13px 26px; border-radius:var(--r-pill); }
`;

const TABS_CSS = `
/* ===== Variant: bottom tab bar ===== */
html.v-tabs nav#nav { display:none; }
html.v-tabs body { padding-bottom: calc(74px + env(safe-area-inset-bottom)); }
html.v-tabs .tabbar {
  position:fixed; left:0; right:0; bottom:0; z-index:50;
  display:flex; align-items:stretch;
  padding-bottom: env(safe-area-inset-bottom);
  background: color-mix(in srgb, var(--felt-deep) 82%, transparent);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  backdrop-filter: blur(20px) saturate(140%);
  border-top:1px solid color-mix(in srgb, var(--rule) 30%, transparent);
}
html.v-tabs .tabbar button {
  flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
  min-height:56px; padding:8px 0 6px; border:none; background:none; cursor:pointer;
  font-family:var(--font-text); font-size:11px; font-weight:500; letter-spacing:.01em;
  color:var(--mast-soft); transition:color .12s ease;
}
/* --mast, not --brass: --mast is guaranteed to carry on whatever the felt is
   in a given theme, where --brass drops to ~2:1 on light felt. */
html.v-tabs .tabbar button.on { color:var(--mast); font-weight:600; }
html.v-tabs .tabbar svg { display:block; width:23px; height:23px; }
`;

const ICONS = {
  Game: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  History: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.4 2"/></svg>',
  Tournament: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 7.6 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16.4 11"/><path d="M12 14v3M9 20h6M10 17h4"/></svg>',
};

/* Only reached against a capture that PREDATES the .empty-state change, where
   the zero-state boards were still a bare <p class="empty">. A current capture
   carries the real thing and this is unused -- B then lands on the shipped
   empty state via the html.v-fill .empty-state rules above, which is the honest
   way to judge it now. */
const LEGACY_EMPTY_STATE = `
<div class="empty-state">
  <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h4"/>
  </svg>
  <h4>No games yet</h4>
  <p>Finished games land here &mdash; final scores, every hand, and who dealt.</p>
  <button class="btn btn-new disp">Start a Game</button>
</div>`;

// Runs inside each iframe once the captured markup is in place.
const TRANSFORM = `
(function () {
  var root = document.documentElement;
  var pad = document.querySelector("#viewRoot > .pad");
  if (root.classList.contains("v-fill") && pad) {
    /* Three cases, in the order they became possible. A current capture hits
       the first: the app ships .empty-state, so B only has to let it grow, and
       the html.v-fill rules already do. */
    if (pad.querySelector(".empty-state")) {
      /* nothing to build — CSS alone */
    } else if (pad.querySelector("p.empty")) {
      pad.querySelector("p.empty").outerHTML = ${JSON.stringify(LEGACY_EMPTY_STATE)};
    } else {
      var filler = document.createElement("div");
      filler.className = "pad-filler";
      pad.appendChild(filler);
    }
  }
  if (root.classList.contains("v-tabs")) {
    var labels = ["Game", "History", "Tournament"];
    var icons = ${JSON.stringify(ICONS)};
    var active = "";
    document.querySelectorAll("nav#nav .nav-btn").forEach(function (b) {
      if (b.classList.contains("on")) active = b.textContent.trim();
    });
    var bar = document.createElement("nav");
    bar.className = "tabbar";
    bar.innerHTML = labels.map(function (l) {
      return '<button class="' + (l === active ? "on" : "") + '">' + icons[l] + "<span>" + l + "</span></button>";
    }).join("");
    document.body.appendChild(bar);
  }
})();
`;

const VARIANTS = [
  { cls: "", title: "A · Current", note: "shrink-wraps to content — includes shipped E" },
  { cls: "v-fill", title: "B · Fill the pad", note: "rejected — sheet grows + ruled remainder" },
  { cls: "v-tabs", title: "C · Bottom tab bar", note: "rejected — nav docked, void remains" },
  { cls: "v-fill v-tabs", title: "D · Both", note: "rejected — B + C combined" },
];

/* Percentages are measure-space.js at 390x844, re-run 2026-07-29. Read them
   against the prose, not on their own -- the bottom four are the screens whose
   numbers look like the top two's and whose problem is not the same. */
const NOTES = {
  "history-empty": "BROKEN — filter chrome around one grey sentence, and the literal first screen a new user sees. 54% empty.",
  "stats-empty": "BROKEN — same shape: four sort chips over nothing to sort. 54% empty.",
  "history-one": "Fine. Short because one game has been played; grows on its own. 39% empty.",
  "stats-list": "Fine. Four rows because there are four players. 35% empty.",
  "tournament-setup": "Fine. A complete card — heading, stepper, primary action, secondary route out. 34% empty.",
};

/* index.html's CSS comments mention "</scr"+"ipt>", which would terminate the
   embedding <script> block. Escaping "<" is the standard mitigation. */
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003C");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>SomeRSet — vertical space prototypes</title>
<style>
  :root { color-scheme: dark; --k: 1; }
  * { box-sizing:border-box; }
  html, body { margin:0; }
  body { font:15px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif;
         background:#121016; color:#EDE6DA; padding:0 0 60px; -webkit-text-size-adjust:100%; }
  .pagepad { padding:22px max(16px, env(safe-area-inset-left)) 0; }
  h1 { font-size:20px; margin:0 0 6px; font-weight:650; letter-spacing:-.01em; }
  .lede { margin:0; color:#A79C8D; max-width:76ch; font-size:14px; }
  .bar { position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:8px;
         margin:16px 0 0; padding:12px max(16px, env(safe-area-inset-left));
         flex-wrap:wrap; background:rgba(18,16,22,.94);
         -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px);
         border-bottom:1px solid #2A2532; }
  .bar span { color:#8E8476; font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
  .bar button { font:600 13px inherit; padding:7px 14px; border-radius:999px; cursor:pointer;
    border:1px solid #3A3442; background:#1E1A26; color:#C9BFB0; }
  .bar button.on { background:#C9A868; border-color:#C9A868; color:#1A1520; }
  h2 { font-size:15px; margin:30px 0 0; padding:20px max(16px, env(safe-area-inset-left)) 0;
       font-weight:650; color:#F3ECDF; border-top:1px solid #2A2532; }
  h2 small { display:block; font-weight:400; color:#8E8476; font-size:13px; margin-top:3px; }
  .row { display:flex; gap:16px; overflow-x:auto; padding:14px max(16px, env(safe-area-inset-left)) 10px;
         scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }
  .cell { flex:0 0 auto; scroll-snap-align:center; }
  .cap { font-size:13px; font-weight:650; margin:0 0 8px; color:#EDE6DA; }
  .cap small { display:block; font-weight:400; color:#8E8476; font-size:12px; }
  .phone-outer { overflow:hidden; border-radius:calc(30px * var(--k));
                 border:1px solid #332D3D; box-shadow:0 14px 36px rgba(0,0,0,.5); background:#000; }
  .phone { transform:scale(var(--k)); transform-origin:top left; overflow:hidden; }
  .phone iframe { border:0; display:block; }
  .hint { margin:0; padding:0 max(16px, env(safe-area-inset-left)); color:#6F6659; font-size:12px; }
  @media (min-width: 1700px) { .hint { display:none; } }
  @media (max-width: 560px) {
    .pagepad { padding-top:16px; } h1 { font-size:17px; } .lede { font-size:13px; }
    .lede .more { display:none; }
    .bar { gap:6px; padding-top:9px; padding-bottom:9px; }
    .bar span { display:none; } .bar button { padding:6px 12px; font-size:12px; }
    h2 { margin-top:22px; padding-top:16px; }
  }
  .foot { margin-top:40px; color:#8E8476; font-size:13px; border-top:1px solid #2A2532;
          padding:18px max(16px, env(safe-area-inset-left)) 0; max-width:80ch; }
  .foot code { background:#1E1A26; padding:1px 5px; border-radius:4px; font-size:12px; }
</style>
</head>
<body>
<div class="pagepad">
  <h1>Vertical space &mdash; what shipped, and what it beat</h1>
  <p class="lede">Real device viewports running the app's actual CSS and DOM. <span class="more">Nothing was redrawn by hand &mdash; the rejected variants are stylesheet overlays on the shipped CSS.</span></p>
  <p class="lede" style="margin-top:8px"><strong>Read the rows top to bottom.</strong> The first two screens looked unfinished; the last three are simply short and grow on their own &mdash; the measurement could not tell those apart, and that is the whole finding. <code>A</code> is <code>index.html</code> as it stands, composed zero states included. <code>B</code> is the one worth looking at rather than reading about: on the lower three, ruling the remainder under a finished card says more is coming.</p>
</div>
<div class="bar">
  <span>Theme</span>
  <button data-theme="aubergine" class="on">Dark</button>
  <button data-theme="aubergine-light">Light</button>
  <span style="margin-left:8px;">Device</span>
  <button data-vp="390x844" class="on">15</button>
  <button data-vp="375x667">SE</button>
  <button data-vp="430x932">Pro Max</button>
</div>
<p class="hint" id="hint"></p>
<div id="out"></div>
<div class="foot">
  <p><strong>Light theme:</strong> flip the toggle to see the audit's first finding directly &mdash; the pad measures 1.13:1 against the felt, so the card, its dashed seam and the inactive tab fills all vanish. That's a colour fix, not a layout one; none of these four variants address it.</p>
</div>
<script>
const APP_CSS = ${js(CSS)};
const VARIANT_CSS = ${js(FILL_CSS + "\n" + TABS_CSS)};
const TRANSFORM = ${js(TRANSFORM)};
const SCREENS = ${js(SCREENS)};
const VARIANTS = ${js(VARIANTS)};
const NOTES = ${js(NOTES)};

let theme = "aubergine";
let vp = { w: 390, h: 844 };

function srcdoc(html, cls) {
  return '<!doctype html><html data-theme="' + theme + '" class="' + cls + '">'
    + '<head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    + '<style>' + APP_CSS + VARIANT_CSS + '</style></head>'
    + '<body>' + html + '<' + 'script>' + TRANSFORM + '<' + '/script></body></html>';
}

/* Scale one frame to fit the screen width, never upscaling past 1:1. The
   transform is visual only — the iframe still LAYS OUT at vp.w, so dvh and
   media queries stay honest. */
function computeK() {
  return Math.max(0.35, Math.min(1, (document.documentElement.clientWidth - 34) / vp.w));
}

function render() {
  const k = computeK();
  document.documentElement.style.setProperty("--k", String(k));
  document.getElementById("hint").textContent =
    k < 1 ? "Swipe each row sideways to compare A / B / C / D." : "";

  const out = document.getElementById("out");
  out.innerHTML = "";
  for (const key of Object.keys(SCREENS)) {
    const sc = SCREENS[key];
    const h2 = document.createElement("h2");
    h2.innerHTML = sc.title + "<small>" + (NOTES[key] || "") + "</small>";
    out.appendChild(h2);

    const row = document.createElement("div");
    row.className = "row";
    for (const v of VARIANTS) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.innerHTML = '<p class="cap">' + v.title + '<small>' + v.note + '</small></p>';

      const outer = document.createElement("div");
      outer.className = "phone-outer";
      outer.style.width = Math.round(vp.w * k) + "px";
      outer.style.height = Math.round(vp.h * k) + "px";

      const phone = document.createElement("div");
      phone.className = "phone";
      phone.style.width = vp.w + "px";
      phone.style.height = vp.h + "px";

      const f = document.createElement("iframe");
      f.style.width = vp.w + "px";
      f.style.height = vp.h + "px";
      f.setAttribute("scrolling", "no");
      f.srcdoc = srcdoc(sc.html, v.cls);

      phone.appendChild(f);
      outer.appendChild(phone);
      cell.appendChild(outer);
      row.appendChild(cell);
    }
    out.appendChild(row);
  }
}

document.querySelectorAll("[data-theme]").forEach(function (b) {
  b.onclick = function () {
    document.querySelectorAll("[data-theme]").forEach(function (x) { x.classList.remove("on"); });
    b.classList.add("on"); theme = b.dataset.theme; render();
  };
});
document.querySelectorAll("[data-vp]").forEach(function (b) {
  b.onclick = function () {
    document.querySelectorAll("[data-vp]").forEach(function (x) { x.classList.remove("on"); });
    b.classList.add("on");
    const p = b.dataset.vp.split("x");
    vp = { w: Number(p[0]), h: Number(p[1]) }; render();
  };
});
let rt;
window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(render, 150); });
render();
</script>
</body>
</html>`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(DEST, page);
console.log("wrote " + DEST + "  (" + (page.length / 1024).toFixed(0) + "KB)");

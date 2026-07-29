"use strict";
/**
 * Contrast / token audit across every theme in index.html.
 *
 * Loads the real app, switches [data-theme] through each palette, resolves the
 * tokens as the browser actually computes them (so var() aliases and
 * color-mix() are real values, not guesses), and reports WCAG contrast for the
 * pairings that carry the design.
 *
 * Ratios under ~1.25 mean the element is effectively invisible against its
 * ground — that is how the light themes' --felt-wash and .pad outline were
 * found to be no-ops.
 *
 *   node archive/design-prototypes/audit-contrast.js
 */

const { start, DEFAULT_PORT } = require("./serve");

const THEMES = ["aubergine", "aubergine-light", "dark", "light"];

/* Runs in the page. Kept as one function so it can be passed to evaluate(). */
const AUDIT = () => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (r) => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => [0, 1, 2].map((i) => Math.round(fg.rgb[i] * fg.a + bg[i] * (1 - fg.a)));

  const NAMES = ["--felt", "--felt-deep", "--cream", "--cream-shade", "--rule", "--ink",
    "--ink-soft", "--red", "--brass", "--brass-text", "--control", "--mast", "--mast-soft",
    "--mast-hi", "--mast-lo", "--felt-wash", "--felt-wash-strong", "--plum"];

  // Paint each token onto a probe element so var() aliases resolve to literals.
  const probe = document.createElement("div");
  document.body.appendChild(probe);
  const resolved = {};
  for (const n of NAMES) {
    probe.style.color = "var(" + n + ")";
    resolved[n] = getComputedStyle(probe).color;
  }
  probe.remove();

  const R = (n) => parse(resolved[n]);
  const felt = R("--felt").rgb;
  const cream = R("--cream").rgb;
  const checks = [];
  const add = (name, a, b, note) => checks.push({ name, ratio: +ratio(a, b).toFixed(3), note });

  add("felt-wash fill vs felt (inactive nav tab, OPTIONS pill)", over(R("--felt-wash"), felt), felt, resolved["--felt-wash"]);
  add("felt-wash-strong vs felt (pressed state)", over(R("--felt-wash-strong"), felt), felt, resolved["--felt-wash-strong"]);
  add(".pad dashed outline vs felt", over({ rgb: cream, a: 0.4 }, felt), felt);
  add("pad (cream) vs felt background", cream, felt);
  add("--plum score bar vs cream-shade track", R("--plum").rgb, R("--cream-shade").rgb);
  add("--rule score bar vs cream-shade track", R("--rule").rgb, R("--cream-shade").rgb);
  add("--mast on felt (masthead)", R("--mast").rgb, felt);
  add("--mast-soft on felt (inactive nav label)", R("--mast-soft").rgb, felt);
  add("--ink-soft on cream (secondary text)", R("--ink-soft").rgb, cream);
  add("--brass-text on cream (dealer / labels)", R("--brass-text").rgb, cream);
  add("--cream on --brass (PRIMARY BUTTON LABEL)", cream, R("--brass").rgb);
  add("--cream on --brass-text (banner label)", cream, R("--brass-text").rgb);
  add("--red on cream (set score)", R("--red").rgb, cream);
  add("--rule vs cream (borders)", R("--rule").rgb, cream);
  add("--cream-shade vs cream (row separators)", R("--cream-shade").rgb, cream);

  return { theme: document.documentElement.getAttribute("data-theme"), checks };
};

(async () => {
  const { chromium } = require("playwright");
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const server = await start(port);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await page.goto("http://127.0.0.1:" + port + "/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    for (const theme of THEMES) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(120);
      const { checks } = await page.evaluate(AUDIT);
      console.log("\n=== theme: " + theme + " ===");
      for (const c of checks) {
        const flag = c.ratio < 1.25 ? "  <<< INVISIBLE" : c.ratio < 3 ? "  (low)" : "";
        console.log(
          "  " + c.ratio.toFixed(2).padStart(7) + "  " + c.name +
          (c.note ? " [" + c.note + "]" : "") + flag
        );
      }
    }
    console.log("\nAA needs 4.5:1 for normal text, 3:1 for large (>=18.66px bold / 24px regular).");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

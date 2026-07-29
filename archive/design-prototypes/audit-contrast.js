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
  /* Two computed forms to handle. A plain colour resolves to rgb()/rgba() with
     0-255 channels; a color-mix() -- which is how the dark themes tint the pad
     seam -- resolves to color(srgb r g b / a) with 0-1 channels instead. Reading
     only the first silently returned null and blew up downstream. */
  const parse = (s) => {
    const str = String(s);
    const srgb = str.match(/color\(srgb\s+([^)]+)\)/);
    if (srgb) {
      const p = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return { rgb: [p[0], p[1], p[2]].map((c) => Math.round(c * 255)), a: p.length > 3 ? p[3] : 1 };
    }
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => [0, 1, 2].map((i) => Math.round(fg.rgb[i] * fg.a + bg[i] * (1 - fg.a)));

  const NAMES = ["--felt", "--felt-deep", "--cream", "--cream-shade", "--rule", "--ink",
    "--ink-soft", "--red", "--brass", "--brass-text", "--control", "--mast", "--mast-soft",
    "--mast-hi", "--mast-lo", "--felt-wash", "--felt-wash-strong", "--plum",
    "--pad-edge", "--pad-seam", "--rule-soft"];

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
  /* `soft` marks a row where a low ratio is not a failure, with the reason. The
     1.25 flag is a hairline/text heuristic and overstates two whole categories:
       - a large fill whose shape is already drawn by its own border (an inactive
         nav tab at 1.11 reads fine, and has shipped that way for months);
       - two adjacent fills that each carry their own AA-compliant text label,
         where nothing is identified by the colour boundary between them.
     What the flag IS right about is a thin line, or a large fill carrying a
     boundary UNAIDED -- which is what the pad was doing at 1.13 before it got an
     edge. Flagging those the same way is what made the pad and the wash read as
     one finding when only the pad needed fixing; don't repeat it by adding a row
     here without deciding which kind it is. */
  const add = (name, a, b, note, soft) => checks.push({ name, ratio: +ratio(a, b).toFixed(3), note, soft });

  add("felt-wash fill vs felt (inactive nav tab, OPTIONS pill)", over(R("--felt-wash"), felt), felt, resolved["--felt-wash"], "bordered fill");
  add("felt-wash-strong vs felt (pressed state)", over(R("--felt-wash-strong"), felt), felt, resolved["--felt-wash-strong"], "bordered fill");
  /* The pad has two possible edge treatments and the real invariant is that
     exactly ONE of them carries the edge on any given ground:
       dark felt   the dashed seam reads (~3.3); no ring, because --cream on a
                   dark --felt is already 13.6:1 and needs no help.
       light felt  the ring reads (~2.5); the seam is the paper's own colour and
                   deliberately does NOT appear, because a dark dashed line 6px
                   out in open felt reads as a box around the pad rather than a
                   stitched edge (see build-pad.js).
     Scoring the two independently reports an INVISIBLE on whichever one is
     deliberately absent -- the same false alarm the felt-wash rows used to
     produce. So each is measured, the absent one is marked soft with its reason,
     and the row that can actually fail is the pair: if NEITHER carries, the pad
     has no edge on that ground and that is a real regression.
     Both are measured against --felt-deep as well: body is a radial gradient,
     and the darker end is the worst case for a warm line. */
  const deep = R("--felt-deep").rgb;
  const CARRIES = 2.0;
  const seam = R("--pad-seam"), ring = R("--pad-edge");
  const seamR = +ratio(over(seam, felt), felt).toFixed(3);
  const ringR = ring.a === 0 ? 0 : +ratio(over(ring, felt), felt).toFixed(3);

  add(".pad dashed seam vs felt", over(seam, felt), felt, resolved["--pad-seam"],
    seamR < CARRIES ? "not the edge on this ground — the ring is" : null);
  add(".pad dashed seam vs felt-deep (gradient's dark end)", over(seam, deep), deep, null,
    seamR < CARRIES ? "not the edge on this ground" : null);

  if (ring.a === 0) {
    checks.push({ name: ".pad edge ring — none, by design (the seam is the edge on dark felt)", ratio: null });
  } else {
    add(".pad edge ring vs felt", over(ring, felt), felt, resolved["--pad-edge"]);
    add(".pad edge ring vs felt-deep (gradient's dark end)", over(ring, deep), deep);
  }
  checks.push({
    name: ".pad HAS an edge (seam or ring carries it — " +
      (seamR >= CARRIES ? "seam " + seamR.toFixed(2) : ringR >= CARRIES ? "ring " + ringR.toFixed(2) : "NEITHER") + ")",
    ratio: Math.max(seamR, ringR),
  });
  /* Still ~1.1 on the light themes and that is not a defect to chase: --cream is
     byte-identical across aubergine/aubergine-light by construction and --felt
     carries --mast-soft's tuning, so neither tone can move. The ring above is
     what carries the edge there -- read the two lines together. */
  add("pad (cream) vs felt background — edge ring above carries this on light felt", cream, felt);
  add("--plum score bar vs cream-shade track", R("--plum").rgb, R("--cream-shade").rgb);
  add("--rule score bar vs cream-shade track", R("--rule").rgb, R("--cream-shade").rgb);
  add("--mast on felt (masthead)", R("--mast").rgb, felt);
  add("--mast-soft on felt (inactive nav label)", R("--mast-soft").rgb, felt);
  add("--ink-soft on cream (secondary text)", R("--ink-soft").rgb, cream);
  add("--brass-text on cream (dealer / labels)", R("--brass-text").rgb, cream);
  /* 2.50:1 in the live themes, against AA's 4.5, and KEPT -- reviewed 2026-07-29
     and judged to read fine in the hand. Soft so it stops presenting as an open
     finding, because it is not one: it has been fixed twice and reverted twice.
     The number is still printed, and still moves if --brass or --cream do, which
     is the point of leaving the row in. Both alternatives are built and rendered
     in build-brass.js; the arithmetic allows no third (see the note beside the
     token in index.html). */
  add("--cream on --brass (PRIMARY BUTTON — below AA, kept deliberately)", cream, R("--brass").rgb, null,
    "reviewed 2026-07-29, reads fine in hand — see build-brass.js");
  add("--cream on --brass-text (banner, Stats bars)", cream, R("--brass-text").rgb);
  /* Edit sits directly beside Delete in the deal-detail row and on swipe. Soft
     because nothing is identified by the boundary between them -- both buttons
     are labelled in words. Worth watching rather than ignoring: it read 1.08
     during the spell when both fills were the deep brass, and a number drifting
     back toward 1 means the two actions are converging on one colour. */
  add("--red vs --brass (Edit beside Delete)", R("--red").rgb, R("--brass").rgb, null, "both labelled in words");
  add("--red on cream (set score)", R("--red").rgb, cream);
  /* These three are one ladder and only mean anything read together: the
     structural divider, the row separator that has to stay under it, and the
     fill tone that is not a line at all. --cream-shade is deliberately last and
     deliberately still low -- as a FILL that is correct, and the row it used to
     fail was the separator job it no longer has. */
  add("--rule vs cream (totals divider, entry pane, sync bar)", R("--rule").rgb, cream);
  add("--rule-soft vs cream (row separators — must stay under --rule)", R("--rule-soft").rgb, cream);
  add("--cream-shade vs cream (fill only: track, pressed, disabled, badge)", R("--cream-shade").rgb, cream, null, "fill, not a line");

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
        if (c.ratio == null) { console.log("        —  " + c.name); continue; }
        /* `soft` rows get a much lower bar than lines and text -- see the note
           above. Below ~1.04 even a large fill has genuinely vanished, so they
           are still checked, just not against 1.25. */
        const floor = c.soft ? 1.04 : 1.25;
        const flag = c.ratio < floor ? "  <<< INVISIBLE" : !c.soft && c.ratio < 3 ? "  (low)" : "";
        console.log(
          "  " + c.ratio.toFixed(2).padStart(7) + "  " + c.name +
          (c.note ? " [" + c.note + "]" : "") + (c.soft ? "  (ok: " + c.soft + ")" : "") + flag
        );
      }
    }
    console.log("\nAA needs 4.5:1 for normal text, 3:1 for large (>=18.66px bold / 24px regular).");
    console.log("Rows marked (ok: …) are flagged below 1.04 rather than 1.25, for the stated");
    console.log("reason — see the note beside `soft` in this file before adding another.");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

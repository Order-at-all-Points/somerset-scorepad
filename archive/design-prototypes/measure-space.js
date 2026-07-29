"use strict";
/**
 * How much of the viewport each screen actually fills, per device.
 *
 * Drives the app into a set of real states (empty, one game, mid-game, full
 * game, stats) and measures the gap between the bottom-most rendered element
 * and the bottom of the viewport. The interesting result is not any single
 * number but the direction: if a screen's dead space GROWS from SE to Pro Max,
 * the layout is shrink-wrapping to content instead of participating in the
 * viewport.
 *
 *   node archive/design-prototypes/measure-space.js
 */

const path = require("path");
const { start, DEFAULT_PORT } = require("./serve");

const PO = path.resolve(__dirname, "..", "..", "stress-test", "lib", "pageobjects");
const seats = require(path.join(PO, "seats"));
const handEntry = require(path.join(PO, "handEntry"));
const nav = require(path.join(PO, "nav"));
const newGame = require(path.join(PO, "newGame"));

const VIEWPORTS = [
  { name: "iPhone SE", w: 375, h: 667 },
  { name: "iPhone 15", w: 390, h: 844 },
  { name: "15 Pro Max", w: 430, h: 932 },
];

async function measure(page, label, rows) {
  const m = await page.evaluate(() => {
    let maxBottom = 0;
    document.querySelectorAll("body *").forEach((e) => {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") return;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const b = r.bottom + window.scrollY;
      if (b > maxBottom) maxBottom = b;
    });
    return { lastEl: Math.round(maxBottom), vh: window.innerHeight };
  });
  const voidPx = Math.max(0, m.vh - m.lastEl);
  rows.push({ label, ...m, voidPx, pct: Math.round((voidPx / m.vh) * 100) });
}

(async () => {
  const { chromium } = require("playwright");
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const server = await start(port);
  const browser = await chromium.launch({ headless: true });
  const url = "http://127.0.0.1:" + port + "/index.html";

  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      const rows = [];
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "aubergine"));

      await measure(page, "Game — fresh, no names", rows);
      await nav.goto(page, "Tournament");
      await measure(page, "Tournament — setup", rows);
      await nav.goto(page, "History");
      await measure(page, "History — empty", rows);
      await nav.goto(page, "Game");

      await seats.nameAllSeats(page, ["Keith", "Dana", "Marcus", "Priya"]);
      await measure(page, "Game — named, 0 deals", rows);

      // Bids are 6..14 (POINTS_PER_DEAL); anything lower is clamped and the
      // stepper silently refuses to move.
      for (const d of [{ s: 0, b: 7, t: 9 }, { s: 1, b: 6, t: 4 }, { s: 2, b: 8, t: 10 }])
        await handEntry.playDeal(page, { bidder: { seat: d.s }, bid: d.b, pointsTaken: d.t });
      await measure(page, "Game — 3 deals", rows);

      const more = [{ s: 3, b: 6, t: 7 }, { s: 0, b: 9, t: 5 }, { s: 1, b: 6, t: 8 },
                    { s: 2, b: 8, t: 11 }, { s: 3, b: 6, t: 3 }, { s: 0, b: 7, t: 9 },
                    { s: 1, b: 6, t: 8 }, { s: 2, b: 9, t: 12 }];
      for (const d of more) {
        if (await newGame.playAgainOfferVisible(page)) break;
        if ((await handEntry.recordDealState(page)).state !== "ready") break;
        await handEntry.playDeal(page, { bidder: { seat: d.s }, bid: d.b, pointsTaken: d.t });
      }
      await measure(page, "Game — full game", rows);
      if (await newGame.playAgainOfferVisible(page)) await newGame.dismissPlayAgainOffer(page);

      await nav.goto(page, "History");
      await measure(page, "History — 1 game", rows);
      await page.locator(".seg-btn", { hasText: "Stats" }).click().catch(() => {});
      await page.waitForTimeout(400);
      await measure(page, "Stats — 4 players", rows);
      await page.locator(".rank-row").first().click().catch(() => {});
      await page.waitForTimeout(500);
      await measure(page, "Stats — player detail", rows);

      console.log("\n### " + vp.name + "  (" + vp.w + "x" + vp.h + ")");
      console.log("    screen                     content ends   viewport   DEAD SPACE");
      for (const r of rows) {
        console.log(
          "    " + r.label.padEnd(26) + " " + String(r.lastEl).padStart(5) + "px      " +
          String(r.vh).padStart(4) + "px    " + String(r.voidPx).padStart(4) + "px (" +
          String(r.pct).padStart(2) + "%) " + "█".repeat(Math.round(r.pct / 4))
        );
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

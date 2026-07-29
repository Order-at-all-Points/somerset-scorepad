"use strict";
/**
 * Captures the real rendered DOM of several app states into out/screens.json,
 * which build-vertical.js then replays inside prototype frames.
 *
 * Capturing rather than hand-writing markup is the whole point: a prototype
 * built from retyped HTML drifts from the app the moment either changes, and
 * you end up reviewing a drawing of the app instead of the app.
 *
 * Regenerate whenever index.html's markup moves. The output is derived data
 * and is gitignored.
 *
 *   node archive/design-prototypes/capture-screens.js
 */

const fs = require("fs");
const path = require("path");
const { start, DEFAULT_PORT, OUT } = require("./serve");

const PO = path.resolve(__dirname, "..", "..", "stress-test", "lib", "pageobjects");
const seats = require(path.join(PO, "seats"));
const handEntry = require(path.join(PO, "handEntry"));
const nav = require(path.join(PO, "nav"));
const newGame = require(path.join(PO, "newGame"));

const DEST = path.join(OUT, "screens.json");

const grab = (page) =>
  page.evaluate(() => {
    const wrap = document.querySelector(".wrap").cloneNode(true);
    // Transient nodes would freeze mid-animation in a static replay.
    wrap.querySelectorAll(".undo-toast, script").forEach((n) => n.remove());
    return wrap.outerHTML;
  });

(async () => {
  const { chromium } = require("playwright");
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const server = await start(port);
  const browser = await chromium.launch({ headless: true });

  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:" + port + "/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);

    const out = {};

    await nav.goto(page, "History");
    out["history-empty"] = { title: "History — empty (first run)", html: await grab(page) };
    await nav.goto(page, "Tournament");
    out["tournament-setup"] = { title: "Tournament — setup", html: await grab(page) };

    await nav.goto(page, "Game");
    await seats.nameAllSeats(page, ["Keith", "Dana", "Marcus", "Priya"]);
    await page.locator(".link-btn", { hasText: "Yes, that's me" }).click().catch(() => {});
    await page.waitForTimeout(200);

    // Bids are 6..14 (POINTS_PER_DEAL).
    const deals = [
      { s: 0, b: 7, t: 9 }, { s: 1, b: 6, t: 4 }, { s: 2, b: 8, t: 10 }, { s: 3, b: 6, t: 7 },
      { s: 0, b: 9, t: 5 }, { s: 1, b: 6, t: 8 }, { s: 2, b: 8, t: 11 }, { s: 3, b: 6, t: 3 },
      { s: 0, b: 7, t: 9 }, { s: 1, b: 6, t: 8 }, { s: 2, b: 9, t: 12 },
    ];
    for (const d of deals) {
      if (await newGame.playAgainOfferVisible(page)) break;
      if ((await handEntry.recordDealState(page)).state !== "ready") break;
      await handEntry.playDeal(page, { bidder: { seat: d.s }, bid: d.b, pointsTaken: d.t });
    }
    if (await newGame.playAgainOfferVisible(page)) await newGame.dismissPlayAgainOffer(page);

    await nav.goto(page, "History");
    out["history-one"] = { title: "History — 1 game", html: await grab(page) };

    await page.locator(".seg-btn", { hasText: "Stats" }).click().catch(() => {});
    await page.waitForTimeout(400);
    out["stats-list"] = { title: "Stats — 4 players", html: await grab(page) };

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(DEST, JSON.stringify(out, null, 2));
    console.log("wrote " + DEST);
    for (const k of Object.keys(out)) console.log("  " + k + "  (" + out[k].html.length + " bytes)");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

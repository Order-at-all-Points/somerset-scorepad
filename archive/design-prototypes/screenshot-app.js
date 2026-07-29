"use strict";
/**
 * Full screenshot sweep of the app, for eyeballing a change across screens.
 *
 * Walks a real game from empty pad to archived history, shooting every screen
 * and sheet along the way, in both live themes. Writes PNGs to out/screens/.
 *
 *   node archive/design-prototypes/screenshot-app.js
 */

const fs = require("fs");
const path = require("path");
const { start, DEFAULT_PORT, OUT } = require("./serve");

const PO = path.resolve(__dirname, "..", "..", "stress-test", "lib", "pageobjects");
const seats = require(path.join(PO, "seats"));
const handEntry = require(path.join(PO, "handEntry"));
const nav = require(path.join(PO, "nav"));
const newGame = require(path.join(PO, "newGame"));

const DEST = path.join(OUT, "screens");

(async () => {
  const { chromium } = require("playwright");
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const server = await start(port);
  const browser = await chromium.launch({ headless: true });
  fs.mkdirSync(DEST, { recursive: true });

  // isMobile/hasTouch synthesise BOTH touch and mouse events for one click(),
  // which double-fires the +/- steppers and silently corrupts every bid. Keep
  // the phone viewport, skip the emulation.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERR:", e.message));

  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(DEST, name + ".png"), fullPage: true });
    console.log("  " + name);
  };
  const theme = async (t) => {
    await page.evaluate((tt) => document.documentElement.setAttribute("data-theme", tt), t);
    await page.waitForTimeout(250);
  };

  try {
    await page.goto("http://127.0.0.1:" + port + "/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    await theme("aubergine");
    await shot("01-fresh-game");

    await seats.nameAllSeats(page, ["Keith", "Dana", "Marcus", "Priya"]);
    await page.locator(".link-btn", { hasText: "Yes, that's me" }).click().catch(() => {});
    await shot("02-named-seats");

    await handEntry.openNewDeal(page);
    await shot("03-entry-bid-step");
    await handEntry.pickBidderSeat(page, 0);
    await handEntry.setBid(page, 7);            // bids are 6..14
    await page.locator(".entry:visible .btn.btn-record", { hasText: /^Record Bid$/ }).click();
    await page.waitForTimeout(300);
    await shot("04-pending-bid-on-pad");

    await page.locator("button.btn.btn-new:visible", { hasText: /^Record Take$/ }).click();
    await page.waitForTimeout(250);
    await shot("05-entry-take-step");
    await handEntry.setPointsTaken(page, 9);
    // Step 2 submits with "Record Take"; submitDeal() is for the edit flow only.
    await page.locator(".entry:visible .btn.btn-record", { hasText: /^Record Take$/ }).click();
    await page.waitForTimeout(200);

    for (const d of [{ s: 1, b: 6, t: 4 }, { s: 2, b: 8, t: 10 }, { s: 3, b: 6, t: 7 },
                     { s: 0, b: 9, t: 5 }, { s: 1, b: 6, t: 8 }])
      await handEntry.playDeal(page, { bidder: { seat: d.s }, bid: d.b, pointsTaken: d.t });
    await shot("06-populated-pad-dark");
    await theme("aubergine-light");
    await shot("07-populated-pad-light");
    await theme("aubergine");

    await page.locator("#gameOptionsToggle:visible").click();
    await page.waitForTimeout(300);
    await shot("08-options-sheet");
    await page.locator('#modalRoot [role="dialog"] .sheet-btn.ghost').last().click().catch(() => {});
    await page.waitForTimeout(250);

    await page.locator("#menuBtn").click();
    await page.waitForTimeout(350);
    await shot("09-settings-sheet");
    await page.locator('#modalRoot [role="dialog"] .sheet-btn.ghost', { hasText: "Done" }).click().catch(() => {});
    await page.waitForTimeout(250);

    await nav.goto(page, "Tournament");
    await shot("10-tournament-setup");
    await nav.goto(page, "Game");

    for (const d of [{ s: 2, b: 8, t: 11 }, { s: 3, b: 6, t: 3 }, { s: 0, b: 7, t: 9 },
                     { s: 1, b: 6, t: 8 }, { s: 2, b: 9, t: 12 }, { s: 3, b: 6, t: 7 }]) {
      if (await newGame.playAgainOfferVisible(page)) break;
      if ((await handEntry.recordDealState(page)).state !== "ready") break;
      await handEntry.playDeal(page, { bidder: { seat: d.s }, bid: d.b, pointsTaken: d.t });
    }
    if (await newGame.playAgainOfferVisible(page)) {
      await shot("11-play-again-sheet");
      await newGame.dismissPlayAgainOffer(page);
    }

    await nav.goto(page, "History");
    await shot("12-history-populated");
    await page.locator(".hist-item").first().click().catch(() => {});
    await page.waitForTimeout(300);
    await shot("13-history-detail");
    await page.locator(".hist-item").first().click().catch(() => {});

    await page.locator(".seg-btn", { hasText: "Stats" }).click().catch(() => {});
    await page.waitForTimeout(400);
    await shot("14-stats-list");
    await page.locator(".rank-row").first().click().catch(() => {});
    await page.waitForTimeout(500);
    await shot("15-stats-player-dark");
    await theme("aubergine-light");
    await shot("16-stats-player-light");

    console.log("\nwrote " + DEST);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

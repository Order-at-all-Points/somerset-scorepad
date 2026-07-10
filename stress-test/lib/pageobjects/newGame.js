"use strict";
const config = require("../../config");
const { parseScores } = require("./util");

// See the note at the top of handEntry.js: the Game tab's #pad can hold a
// stale, hidden copy of a previous scorepad, so every selector here is
// `:visible`-scoped to avoid matching it.

/** Two team running totals, e.g. [12, -4]. Always exactly 2 in Game/Match view. */
async function readTeamTotals(page) {
  const strs = await page.locator(".score.mono:visible").allTextContents();
  return parseScores(strs);
}

/** "We Win!" / "They Win!" text, or null if the game isn't over. */
async function readWinnerBanner(page) {
  const banner = page.locator(".banner:visible");
  if ((await banner.count()) === 0) return null;
  return (await banner.first().textContent()).trim();
}

/**
 * After ANY casual-game win (solo Game tab, or a match/series game that just
 * completed) the app auto-opens an escalation sheet -- offering a best-of-N
 * rematch, a redraw, or dismissal. Its `aria-label` depends on the target
 * length: exactly "Play again?" when escalating to bestOf===3, but "Play
 * Best of 5"/"Play Best of 7" for the next rungs up the ladder (see
 * `renderModal`'s `ui.offerSeries` branch, ~line 2626) -- both variants are
 * the same feature and need the same handling, so match either. Every other
 * UI action is blocked behind its overlay until it's resolved.
 */
const OFFER_SERIES_SELECTOR = '[role="dialog"][aria-label="Play again?"], [role="dialog"][aria-label^="Play Best of "]';

async function playAgainOfferVisible(page) {
  return (await page.locator(OFFER_SERIES_SELECTOR).count()) > 0;
}

async function dismissPlayAgainOffer(page) {
  const dlg = page.locator(OFFER_SERIES_SELECTOR);
  if ((await dlg.count()) === 0) return false;
  await dlg.locator(".sheet-btn.ghost", { hasText: "No thanks" }).click();
  await page.waitForTimeout(80);
  return true;
}

/** Accept the primary "Rematch? Best of N?" / "Yes, Best of N" escalation offer. */
async function acceptRematchEscalation(page) {
  const dlg = page.locator(OFFER_SERIES_SELECTOR);
  await dlg.locator(".sheet-btn.primary").click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(120);
}

async function acceptRedrawEscalation(page) {
  const dlg = page.locator(OFFER_SERIES_SELECTOR);
  await dlg.locator(".sheet-btn", { hasText: "Redraw" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(120);
}

/**
 * A shared/linked game (gameHasTourneyLink()) never shows the "Play again?"
 * escalation dialog or the plain post-win "New Game" button -- it shows a
 * "Continue" (or, for bestOf>1, "Play Game N"/"Continue") button wired to
 * `advanceSharedGame`, and keeps `.game` populated on the tourney record
 * until that's tapped. Other devices' auto-archive-to-History deliberately
 * waits for `.game` to be nulled (see syncMyHistoryFromTourney's `if
 * (m.game) return`), so skipping this tap leaves teammates' History
 * permanently missing the entry, not just delayed.
 */
async function continueSharedGame(page) {
  const btn = page.locator(".add-wrap .btn.btn-new:visible", { hasText: /Continue|Play Game \d+/ });
  if ((await btn.count()) === 0) return false;
  await btn.click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(150);
  return true;
}

/** The plain "New Game" button shown directly on the pad once a game is won (no confirm). */
async function clickNewGameDirect(page) {
  await page
    .locator(".add-wrap .btn.btn-new:visible", { hasText: "New Game" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(80);
}

/** Options -> New Game -> confirm sheet, for resetting a game that's still mid-play. Game tab only. */
async function newGameViaOptions(page, { confirm = true } = {}) {
  await page.locator("#gameOptionsToggle:visible").click();
  await page.locator(".sheet-btn", { hasText: "New Game" }).click();
  await page.waitForTimeout(60);
  if (confirm) {
    await page.locator(".sheet-btn.primary", { hasText: "Yes, start fresh" }).click();
  } else {
    await page.locator(".sheet-btn.ghost", { hasText: "Keep playing" }).click();
  }
  await page.waitForTimeout(80);
}

module.exports = {
  readTeamTotals,
  readWinnerBanner,
  playAgainOfferVisible,
  dismissPlayAgainOffer,
  acceptRematchEscalation,
  acceptRedrawEscalation,
  clickNewGameDirect,
  newGameViaOptions,
  continueSharedGame,
};

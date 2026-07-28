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
 * After ANY Standard-game win (solo Game tab, or a match game that just
 * completed) the app auto-opens a "Play again?" sheet -- same teams, redraw,
 * or no thanks (see `renderModal`'s `ui.rematchOffer` branch). Every other UI
 * action is blocked behind its overlay until it's resolved.
 *
 * The `aria-label^="Play Best of "` half of the selector is dead: it matched
 * the best-of-3/5/7 escalation ladder that went away with the series mode on
 * 2026-07-22. Kept as a harmless no-match so a run against an older build
 * still resolves the sheet rather than hanging on it.
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

/**
 * Hamburger (#menuBtn) -> Settings sheet -> "Moon Shot" row -> picker sheet.
 * With no deals recorded yet, selecting the other mode applies directly; once
 * deals exist it opens a scope step instead (same sheet,
 * `ui.moonShotSheet = { step:"scope" }` in index.html) that must pick "Just
 * this game" or "From now on" -- `scope` selects which. Both take effect from
 * the very next deal of the game in progress; they differ only in whether the
 * device-wide default for future games moves too ("future" persists it).
 *
 * Only meaningful for a solo/unlinked game: while a tournament is active the
 * row shows that tournament's locked-at-setup mode and isn't tappable at all.
 */
async function setInstantDeathMoon(page, { on = true, scope = "game" } = {}) {
  await page.locator("#menuBtn").click();
  const settingsSheet = page.locator('[role="dialog"][aria-label="Settings"]');
  await settingsSheet.waitFor();
  const label = on ? "Instant Death" : "Classic";
  const row = settingsSheet.locator(".settings-row", { hasText: "Moon Shot" });
  if ((await row.innerText()).includes(label)) {
    await settingsSheet.locator(".sheet-btn.ghost", { hasText: "Done" }).click();
    await page.waitForTimeout(60);
    return;
  }
  await row.click();
  await page.waitForTimeout(60);
  const pickerSheet = page.locator('[role="dialog"][aria-label="Moon Shot"]');
  await pickerSheet.locator("button.sheet-btn", { hasText: label }).click();
  await page.waitForTimeout(60);
  const scopeSheet = page.locator('[role="dialog"][aria-label="Moon Shot"] h3', { hasText: /^Switch to/ });
  if (await scopeSheet.count()) {
    const scopeLabel = scope === "future" ? "From now on" : "Just this game";
    await page.locator('[role="dialog"][aria-label="Moon Shot"] .sheet-btn', { hasText: scopeLabel }).click();
    await page.waitForTimeout(60);
  }
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
  setInstantDeathMoon,
  continueSharedGame,
};

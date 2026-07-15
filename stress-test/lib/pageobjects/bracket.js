"use strict";
const config = require("../../config");

/**
 * Open the match-options sheet for the next playable match, across all four
 * formats: single/double elim expose a `.tnext` "tap to play" shortcut when
 * there's exactly one obvious next match, falling back to any `.mbox.ready`
 * box; round robin has no `.tnext` and is driven purely via `.rr-row`s (used
 * by both Round Robin's schedule grid and Best-of Series' game list).
 * Returns false if nothing is playable (tournament/series already decided).
 */
async function openNextMatch(page) {
  const tnext = page.locator(".tnext:visible");
  if (await tnext.count()) {
    await tnext.first().click({ timeout: config.actionTimeoutMs });
    await page.waitForTimeout(80);
    return true;
  }
  const ready = page.locator(".mbox.ready:visible");
  if (await ready.count()) {
    await ready.first().click({ timeout: config.actionTimeoutMs });
    await page.waitForTimeout(80);
    return true;
  }
  const undecidedRow = page
    .locator(".rr-row:visible")
    .filter({ has: page.locator(".rr-result:not(.set)") });
  if (await undecidedRow.count()) {
    await undecidedRow.first().click({ timeout: config.actionTimeoutMs });
    await page.waitForTimeout(80);
    return true;
  }
  return false;
}

function matchOptionsDialog(page) {
  return page.locator('[role="dialog"][aria-label="Match options"]');
}

async function matchOptionsHeader(page) {
  return (await matchOptionsDialog(page).locator("h3").textContent()).trim();
}

async function playInApp(page) {
  await matchOptionsDialog(page)
    .locator(".sheet-btn.primary", { hasText: /Play in app|Resume game/ })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(100);
}

/** Record a match's winner without playing it in-app -- "<TeamName> Won" + confirm. */
async function recordManualWin(page, teamName) {
  const dlg = matchOptionsDialog(page);
  await dlg.locator(".sheet-btn", { hasText: `${teamName} Won` }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
  await dlg.locator(".sheet-btn.primary").click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(120);
}

async function cancelMatchOptions(page) {
  await matchOptionsDialog(page).locator(".sheet-btn.ghost", { hasText: "Cancel" }).click();
  await page.waitForTimeout(60);
}

async function returnToBracket(page) {
  await page
    .locator(".btn.btn-new:visible", { hasText: "Return to Bracket" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(150);
}

/** "Champions: <team>" text once the tournament is decided, else null. Reuses .banner (shared with a plain game win). */
async function championText(page) {
  const banner = page.locator(".banner:visible", { hasText: "Champions:" });
  if ((await banner.count()) === 0) return null;
  return (await banner.textContent()).trim();
}

async function rematchSameTeams(page) {
  await page.locator(".btn.btn-new:visible", { hasText: "Rematch with same teams" }).click();
  await page.waitForTimeout(150);
}

async function redrawAndReplay(page) {
  await page.locator(".btn.btn-add:visible", { hasText: "Redraw teams & play again" }).click();
  await page.waitForTimeout(150);
}

/** "End Tournament"/"Leave Tournament" (host vs guest) -> confirm sheet -> "Yes, end it"/"Yes, leave". */
async function endTournament(page) {
  await page
    .locator(".btn.btn-cancel:visible", { hasText: /End Tournament|Leave Tournament|End Game|Leave Game/ })
    .click();
  await page.waitForTimeout(60);
  await page
    .locator('[role="dialog"][aria-label="End or leave"] .sheet-btn', { hasText: /Yes, end it|Yes, leave/ })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(100);
}

async function standingsRows(page) {
  return page.locator(".rr-standings tr").allTextContents();
}

/**
 * Best-of Series only: the app deliberately leaves `tourney.champion` null
 * on the clinching game itself (until an explicit "Continue" tap on the Game
 * tab finalizes it) -- this is exactly the window the recent
 * escalation/"Play Game N" label regressions live in, so scenarios need to
 * be able to read "is this series actually over" from the bracket-list view
 * itself rather than relying on `championText()` (which only ever fires for
 * single/double/round tournaments, never a series).
 */
async function seriesSubText(page) {
  const sub = page.locator(".series-sub:visible");
  if ((await sub.count()) === 0) return null;
  return (await sub.first().textContent()).trim();
}

/** 0 or 1 once a side is visually marked as series champion, else null. */
async function seriesChampSide(page) {
  const champ = page.locator(".series-side:visible .series-team-name.champ");
  if ((await champ.count()) === 0) return null;
  const allNames = await page.locator(".series-side:visible .series-team-name").allTextContents();
  const champName = (await champ.first().textContent()).trim();
  return allNames.findIndex((n) => n.trim() === champName);
}

/** [team0Wins, team1Wins] as shown on the series scoreboard (bracket-list view). */
async function seriesWinsCount(page) {
  const strs = await page.locator(".series-side:visible .series-wins").allTextContents();
  return strs.map((s) => parseInt(s, 10));
}

/** Open the match-options sheet for a specific already-decided series game row ("Game N"). */
async function openSeriesGameRow(page, gameNo) {
  await page
    .locator(".rr-row:visible")
    .filter({ has: page.locator(".series-game-label", { hasText: new RegExp(`^Game ${gameNo}$`) }) })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(80);
}

/** From an open match-options sheet on a decided series game, clear its result (undo). */
async function clearSeriesGameResult(page) {
  await matchOptionsDialog(page)
    .locator(".sheet-btn", { hasText: "Clear result" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(150);
}

module.exports = {
  openNextMatch,
  matchOptionsDialog,
  matchOptionsHeader,
  playInApp,
  recordManualWin,
  cancelMatchOptions,
  returnToBracket,
  championText,
  rematchSameTeams,
  redrawAndReplay,
  endTournament,
  standingsRows,
  seriesSubText,
  seriesChampSide,
  seriesWinsCount,
  openSeriesGameRow,
  clearSeriesGameResult,
};

"use strict";
const config = require("../../config");
const nav = require("./nav");

/** Navigate to History tab, then the Stats sub-view (leaderboard). */
async function openStatsBoard(page) {
  await nav.goto(page, "History");
  await page.locator(".seg-btn", { hasText: "Stats" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

/** From the Stats leaderboard, open a player's detail sheet by name. */
async function openPlayerDetail(page, name) {
  await page.locator(".rank-row .rank-name", { hasText: name }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

/** From an open player detail view, read the "Games played" tile's number. */
async function gamesPlayed(page) {
  const tile = page.locator(".stats-tile-grid .stats-tile").first().locator(".stats-tile-num");
  if ((await tile.count()) === 0) return null;
  return Number((await tile.textContent()).trim());
}

/** Convenience: nav to Stats, open `name`'s detail, return their games-played count. */
async function readGamesPlayed(page, name) {
  await openStatsBoard(page);
  if ((await page.locator(".rank-row .rank-name", { hasText: name }).count()) === 0) return 0;
  await openPlayerDetail(page, name);
  return gamesPlayed(page);
}

module.exports = { openStatsBoard, openPlayerDetail, gamesPlayed, readGamesPlayed };

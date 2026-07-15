"use strict";
const config = require("../../config");

async function fillNames(page, names) {
  for (let i = 0; i < names.length; i++) {
    await page.locator(".tinput").nth(i).fill(names[i]);
  }
}

async function selectBestOf(page, n) {
  await page.locator(".chips .chip", { hasText: `Best of ${n}` }).click({ timeout: config.actionTimeoutMs });
}

async function selectTeamsMode(page, mode) {
  const label = mode === "random" ? "Random" : "Choose";
  await page.locator(".chips .chip", { hasText: label }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(40);
}

async function drawTeams(page) {
  await page
    .locator(".btn.btn-add:visible", { hasText: /Draw teams|Re-draw teams/ })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

/** "Choose" mode only: pick player1's partner by that player's exact name. */
async function choosePartner(page, partnerName) {
  await page.locator(".chips .chip", { hasText: partnerName }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

async function drawnTeams(page) {
  return page.locator(".draw-list .draw-team:visible").allTextContents();
}

async function startSeries(page) {
  await page.locator(".btn.btn-new:visible", { hasText: "Start series" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(150);
}

/** Full flow: names -> bestOf -> random draw -> start. Returns the drawn-team labels. */
async function setupAndStartRandom(page, { names, bestOf }) {
  await fillNames(page, names);
  await selectBestOf(page, bestOf);
  // "random" is the default mode; drawing explicitly still works and is more deterministic to drive.
  await drawTeams(page);
  const teams = await drawnTeams(page);
  await startSeries(page);
  return teams;
}

module.exports = {
  fillNames,
  selectBestOf,
  selectTeamsMode,
  drawTeams,
  choosePartner,
  drawnTeams,
  startSeries,
  setupAndStartRandom,
};

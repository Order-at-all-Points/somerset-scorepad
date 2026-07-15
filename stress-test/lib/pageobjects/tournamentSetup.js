"use strict";
const config = require("../../config");

const FORMAT_CHIP = { single: "Single Elim", double: "Double Elim", round: "Round Robin" };
const FORMAT_START_TEXT = {
  single: "Start Single Elimination",
  double: "Start Double Elimination",
  round: "Start Round Robin",
};

async function currentCount(page) {
  return parseInt(await page.locator(".count-val").textContent(), 10);
}

async function setPlayerCount(page, target) {
  // The +/- buttons move in steps of 2 (ui.tCount +=/-= 2) since player
  // count must stay even -- min 6.
  let count = await currentCount(page);
  let guard = 0;
  while (count !== target && guard < 40) {
    if (count < target) {
      await page.locator('.step[aria-label="More players"]').click();
      count += 2;
    } else {
      await page.locator('.step[aria-label="Fewer players"]').click();
      count -= 2;
    }
    guard++;
  }
  const finalCount = await currentCount(page);
  if (finalCount !== target) {
    throw new Error(`player count stepper ended at ${finalCount}, expected ${target}`);
  }
}

async function countValidityText(page) {
  return (await page.locator(".tvalid").first().textContent()).trim();
}

async function proceedToNames(page) {
  // :visible avoids the stale hidden "Record Deal 1" left behind in #pad by
  // the Game tab's initial render (see the note atop handEntry.js) -- both
  // match `.btn.btn-new` and a plain `hasText` filter isn't visibility-aware.
  await page
    .locator(".btn.btn-new:visible", { hasText: /Set up \d+ players/ })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

async function fillNames(page, names) {
  for (let i = 0; i < names.length; i++) {
    await page.locator(".tinput").nth(i).fill(names[i]);
  }
}

async function nameValidityText(page) {
  return (await page.locator(".tvalid").first().textContent()).trim();
}

async function selectFormat(page, format) {
  await page.locator(".chips.chips-fit .chip", { hasText: FORMAT_CHIP[format] }).click();
  await page.waitForTimeout(40);
}

async function drawTeams(page) {
  await page
    .locator(".btn.btn-add:visible", { hasText: /Draw teams|Re-draw teams/ })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

async function drawnTeams(page) {
  return page.locator(".draw-list .draw-team:visible").allTextContents();
}

async function startTournament(page, format) {
  await page
    .locator(".btn.btn-new:visible", { hasText: FORMAT_START_TEXT[format] })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(150);
}

/** Full flow: count -> names -> format -> draw -> start. Returns the drawn-team labels. */
async function setupAndStart(page, { names, format }) {
  await setPlayerCount(page, names.length);
  await proceedToNames(page);
  await fillNames(page, names);
  if (format !== "single") await selectFormat(page, format);
  await drawTeams(page);
  const teams = await drawnTeams(page);
  await startTournament(page, format);
  return teams;
}

async function openBestOfSeriesSetup(page) {
  await page.locator(".btn.btn-add:visible", { hasText: "Best-of Series" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

async function openJoinSheet(page) {
  await page
    .locator(".btn.btn-cancel:visible", { hasText: "Join with code" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

module.exports = {
  currentCount,
  setPlayerCount,
  countValidityText,
  proceedToNames,
  fillNames,
  nameValidityText,
  selectFormat,
  drawTeams,
  drawnTeams,
  startTournament,
  setupAndStart,
  openBestOfSeriesSetup,
  openJoinSheet,
};

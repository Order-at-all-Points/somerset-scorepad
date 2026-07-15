"use strict";
const config = require("../../config");
const { setStepper } = require("./util");

// The Game tab (#gameView/#pad) and the active Tournament/Match view
// (#viewRoot) are mutually-exclusive-by-display but NOT mutually exclusive
// in the DOM: whichever one was populated most recently keeps its markup
// (just hidden via display:none) until the Game tab is shown again. A
// fresh page load always renders the solo Game tab first, so a hidden
// "Record Deal 1" (etc.) can linger there for the rest of the session even
// while we're driving a tournament match in #viewRoot. Every selector here
// is scoped to `:visible` (or to the live `.entry:visible` container) so it
// can never accidentally match that stale hidden copy.

function entryScope(page) {
  return page.locator(".entry:visible");
}

/** True once every seat has a name -- switches Step 1 from team buttons to per-seat buttons. */
async function isNamedMode(page) {
  return (await entryScope(page).locator(".who.grid4").count()) > 0;
}

/**
 * Info about the "Record Deal N" affordance in its current state:
 *  - { state: "ready", dealNo }        -- button present, can open a new deal
 *  - { state: "locked", text }         -- someone else holds this hand's lock (.view-only-bar)
 *  - { state: "unavailable" }          -- neither present (e.g. game already won)
 */
async function recordDealState(page) {
  const btn = page.locator("button.btn.btn-new:visible", { hasText: /Record Deal/ });
  if (await btn.count()) {
    const text = await btn.first().textContent();
    const dealNo = parseInt(text.replace(/\D+/g, ""), 10);
    return { state: "ready", dealNo };
  }
  const lockedBar = page.locator(".view-only-bar:visible", { hasText: "Someone else is currently entering this hand" });
  if (await lockedBar.count()) return { state: "locked", text: await lockedBar.first().textContent() };
  return { state: "unavailable" };
}

async function openNewDeal(page) {
  await page
    .locator("button.btn.btn-new:visible", { hasText: /Record Deal/ })
    .click({ timeout: config.actionTimeoutMs });
  await entryScope(page).waitFor({ state: "visible", timeout: config.actionTimeoutMs });
}

/** Named mode: pick the bidder by absolute seat index (0-3, robust to any viewer-perspective reordering). */
async function pickBidderSeat(page, seat) {
  await entryScope(page).locator(".who.grid4 button").nth(seat).click({ timeout: config.actionTimeoutMs });
}

/** Unnamed mode only: pick the bidding team by its rendered button index (0 or 1). */
async function pickBidderTeamIndex(page, teamIndex) {
  await entryScope(page).locator(".who button").nth(teamIndex).click({ timeout: config.actionTimeoutMs });
}

async function setBid(page, bid) {
  await setStepper(entryScope(page), "bid", bid);
}

async function bidderWarnText(page) {
  const warn = entryScope(page).locator('.warn[role="alert"]');
  if ((await warn.count()) === 0) return null;
  return (await warn.textContent()).trim();
}

/** Advance from Step 1 to Step 2. Returns the bidder-warning text if the app blocked the advance. */
async function goToStep2(page) {
  await entryScope(page)
    .locator(".btn.btn-record", { hasText: "Next: play the hand" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
  return bidderWarnText(page);
}

async function setPointsTaken(page, pts) {
  await setStepper(entryScope(page), "points taken", pts);
}

/** Inline "went set" / "shot the MOON" messages shown on Step 2 before submitting. */
async function resultWarnings(page) {
  return entryScope(page).locator(".warn.strong").allTextContents();
}

async function submitDeal(page) {
  await entryScope(page)
    .locator(".btn.btn-record", { hasText: /Record deal|Save changes/ })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(120);
}

async function cancelEntry(page) {
  await entryScope(page).locator(".btn.btn-cancel").click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

/** Full step1+step2 flow for one deal. `bidder` is either {seat} (named mode) or {teamIndex}. */
async function playDeal(page, { bidder, bid, pointsTaken }) {
  await openNewDeal(page);
  if ("seat" in bidder) await pickBidderSeat(page, bidder.seat);
  else await pickBidderTeamIndex(page, bidder.teamIndex);
  await setBid(page, bid);
  const warn = await goToStep2(page);
  if (warn) throw new Error(`Unexpected bidder warning: ${warn}`);
  await setPointsTaken(page, pointsTaken);
  const warnings = await resultWarnings(page);
  await submitDeal(page);
  return { warnings };
}

module.exports = {
  isNamedMode,
  recordDealState,
  openNewDeal,
  pickBidderSeat,
  pickBidderTeamIndex,
  setBid,
  bidderWarnText,
  goToStep2,
  setPointsTaken,
  resultWarnings,
  submitDeal,
  cancelEntry,
  playDeal,
};

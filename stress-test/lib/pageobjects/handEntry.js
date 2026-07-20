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

// Entry is a two-phase flow now: a new hand starts with "Record Bid" (place the
// bid; broadcasts as game.pendingBid and closes the sheet so every device sees
// it), then anyone records the result via a separate "Record Take" button on
// the pad. (Editing an already-recorded deal still keeps both steps in one
// on-device flow -- "Next: play the hand →" then "Save changes".)
function newBidBtn(page) {
  return page.locator("button.btn.btn-new:visible", { hasText: /^Record Bid$/ });
}
function recordTakeBtn(page) {
  return page.locator("button.btn.btn-new:visible", { hasText: /^Record Take$/ });
}

/**
 * Info about the new-hand affordance in its current state:
 *  - { state: "ready" }        -- "Record Bid" present, a new hand can be started
 *  - { state: "take" }         -- a bid is placed; the pad shows "Record Take"
 *  - { state: "locked", text } -- someone else holds this hand's lock (.view-only-bar)
 *  - { state: "unavailable" }  -- none present (e.g. game already won)
 */
async function recordDealState(page) {
  if (await newBidBtn(page).count()) return { state: "ready" };
  if (await recordTakeBtn(page).count()) return { state: "take" };
  const lockedBar = page.locator(".view-only-bar:visible", {
    hasText: /Someone else is currently entering|being edited on another device|playing the hand/,
  });
  if (await lockedBar.count()) return { state: "locked", text: await lockedBar.first().textContent() };
  return { state: "unavailable" };
}

async function openNewDeal(page) {
  await newBidBtn(page).click({ timeout: config.actionTimeoutMs });
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

/**
 * Full two-phase flow for one new deal: place the bid, then record the take.
 * `bidder` is either {seat} (named mode) or {teamIndex} (quick mode).
 */
async function playDeal(page, { bidder, bid, pointsTaken }) {
  // --- Phase 1: bid ---
  await openNewDeal(page);
  if ("seat" in bidder) await pickBidderSeat(page, bidder.seat);
  else await pickBidderTeamIndex(page, bidder.teamIndex);
  await setBid(page, bid);
  await entryScope(page)
    .locator(".btn.btn-record", { hasText: /^Record Bid$/ })
    .click({ timeout: config.actionTimeoutMs });
  const warn = await bidderWarnText(page);
  if (warn) throw new Error(`Unexpected bidder warning: ${warn}`);
  // The sheet closes on a successful bid; the pad now offers "Record Take".
  await recordTakeBtn(page).waitFor({ state: "visible", timeout: config.actionTimeoutMs });

  // --- Phase 2: take ---
  await recordTakeBtn(page).click({ timeout: config.actionTimeoutMs });
  await entryScope(page).waitFor({ state: "visible", timeout: config.actionTimeoutMs });
  await setPointsTaken(page, pointsTaken);
  const warnings = await resultWarnings(page);
  await entryScope(page)
    .locator(".btn.btn-record", { hasText: /^Record Take$/ })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(120);
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

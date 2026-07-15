"use strict";
const config = require("../../config");

// See the note at the top of handEntry.js re: stale hidden copies of the
// scorepad -- `:visible` scoping applies here for the same reason.

function rowWrapLocator(page, dealNo) {
  return page
    .locator(".deal-row-wrap:visible")
    .filter({ has: page.locator(`[aria-label="Deal ${dealNo}, show dealer and options"]`) });
}

async function dealCount(page) {
  return page.locator('[aria-label$=", show dealer and options"]:visible').count();
}

/** Tap a deal row to expand its detail (dealer, per-hand info). Toggles if already open. */
async function toggleDealDetail(page, dealNo) {
  await rowWrapLocator(page, dealNo)
    .locator(".deal-row")
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

/**
 * Edit/Delete buttons sit UNDER the foreground row (`.deal-row-fg`, which
 * stacks on top and covers the same coordinates at rest) until a swipe
 * gesture slides the foreground away -- so even Playwright's `force: true`
 * click (still coordinate/hit-test based) lands on the foreground row
 * instead. Invoke the button's own `.click()` directly in-page to bypass
 * hit-testing entirely.
 */
async function editDeal(page, dealNo) {
  await rowWrapLocator(page, dealNo)
    .locator(".swipe-action-btn.edit")
    .evaluate((el) => el.click());
  await page.locator(".entry:visible").waitFor({ state: "visible", timeout: config.actionTimeoutMs });
}

async function deleteDeal(page, dealNo) {
  await rowWrapLocator(page, dealNo)
    .locator(".swipe-action-btn.delete")
    .evaluate((el) => el.click());
  await page.waitForTimeout(80);
}

async function undoToastVisible(page) {
  return (await page.locator(".undo-toast").count()) > 0;
}

async function clickUndo(page) {
  await page.locator(".undo-toast button", { hasText: "Undo" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(80);
}

module.exports = { dealCount, toggleDealDetail, editDeal, deleteDeal, undoToastVisible, clickUndo };

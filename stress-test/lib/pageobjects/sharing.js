"use strict";
const config = require("../../config");
const linking = require("./linking");

/**
 * Stats Sharing UI (Display sheet -> Stats Sharing). The People list, the
 * master toggle, and the Display-sheet On/Off row.
 */

function sheet(page) {
  return page.locator('[role="dialog"][aria-label="Stats sharing"]');
}

/**
 * Opens Display -> Stats Sharing. Leaves the sharing sheet open.
 * Tolerates the Display sheet already being open: its overlay covers #menuBtn,
 * so blindly re-tapping the menu button would just time out (callers like
 * linking.enableBackupViaToggle deliberately leave it open).
 */
async function ensureDisplaySheet(page) {
  if ((await linking.displaySheet(page).count()) === 0) await linking.openDisplaySheet(page);
}

async function openSheet(page) {
  if ((await sheet(page).count()) > 0) return;
  await ensureDisplaySheet(page);
  await linking.displaySheet(page)
    .locator(".settings-row-label", { hasText: "Stats Sharing" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(150);
}

/** Closes whichever sheet is on top via its Done button. */
async function closeSheet(page) {
  const btn = page.locator('[role="dialog"] .sheet-btn.ghost', { hasText: "Done" }).first();
  if (await btn.count()) await btn.click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(150);
}

function masterToggle(page) {
  return sheet(page).locator('[aria-label="Share stats with people I play"]');
}

/**
 * The Display sheet's "Stats Sharing" row state text ("On"/"Off") -- what the
 * app TELLS the user about sharing, as opposed to what is actually published.
 * Opens the Display sheet and leaves it open.
 */
async function displayRowState(page) {
  await ensureDisplaySheet(page);
  const row = linking.displaySheet(page)
    .locator('.settings-row[aria-label="Stats sharing"] .settings-row-state');
  return (await row.textContent()).trim();
}

/**
 * Drive the master toggle to `want`. Returns its resulting aria-checked state.
 * Opens and closes the sharing sheet around the tap. Returns null if the toggle
 * isn't rendered at all (the sheet gates it on Cloud Backup being on).
 */
async function setMaster(page, want) {
  await openSheet(page);
  if ((await masterToggle(page).count()) === 0) { await closeSheet(page); return null; }
  const cur = (await masterToggle(page).getAttribute("aria-checked")) === "true";
  if (cur !== want) {
    await masterToggle(page).click({ timeout: config.actionTimeoutMs });
    await page.waitForTimeout(1800);   // ensureStatsProfile + grant/revoke round-trips
  }
  const now = (await masterToggle(page).getAttribute("aria-checked")) === "true";
  await closeSheet(page);
  return now;
}

/** True if the sharing sheet is showing its backup-off dead-end branch. */
async function isBackupOffBranch(page) {
  return (await sheet(page).locator(".sheet-btn.primary", { hasText: "Set up Cloud Backup" }).count()) === 1;
}

/** How many People rows the sharing sheet is showing. Sheet must be open. */
async function peerRowCount(page) {
  return sheet(page).locator(".peer-row").count();
}

/** The per-person "share my stats with X" toggle. Sheet must be open. */
function peerShareToggle(page, name) {
  return sheet(page).locator(`[aria-label="Share my stats with ${name}"]`);
}

module.exports = {
  sheet,
  ensureDisplaySheet,
  openSheet,
  closeSheet,
  masterToggle,
  displayRowState,
  setMaster,
  isBackupOffBranch,
  peerRowCount,
  peerShareToggle,
};

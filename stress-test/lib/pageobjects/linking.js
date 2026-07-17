"use strict";
const config = require("../../config");
const storage = require("./storage");

/**
 * Wait until `page`'s local linkedUids contains `uid` (or `attempts` run out,
 * ~1s each). subscribeLinkedHistories writes linkedUids on every membership
 * snapshot and only then attaches that peer's history listener, so this is the
 * real precondition for "this device will merge that peer's games." Racing a
 * peer's gameplay ahead of it is what made the cross-device merge checks flaky;
 * in real use, seconds-to-minutes of human time cover this window. Returns true
 * if the uid appeared, false on timeout.
 */
async function waitForLinkedUid(page, uid, attempts = 15) {
  for (let i = 0; i < attempts; i++) {
    const linked = (await storage.readKey(page, storage.KEYS.linkedUids)).value || [];
    if (linked.indexOf(uid) !== -1) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

/** Opens the Display sheet (gear/menu icon), the entry point for device linking. */
async function openDisplaySheet(page) {
  await page.locator("#menuBtn").click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

function displaySheet(page) {
  return page.locator('[role="dialog"][aria-label="Display settings"]');
}

/**
 * From the open Display sheet, tap the "Cloud Backup" row to open the full
 * link-device sheet (menu/show/enter/confirm/unlink steps). This is the row
 * label's tap target, not the iOS-style toggle beside it -- the toggle acts
 * immediately (see index.html's Display-sheet render) rather than opening
 * this sheet, so tests that need the toggle itself use a separate locator.
 */
async function openLinkDeviceSheet(page) {
  await displaySheet(page)
    .locator(".settings-row-label", { hasText: "Cloud Backup" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

/** The iOS-style toggle beside the "Cloud Backup" row on the Display sheet. */
function cloudBackupToggle(page) {
  return displaySheet(page).locator(".ios-toggle");
}

function linkDeviceSheet(page) {
  return page.locator('[role="dialog"][aria-label="Link this device"]');
}

/**
 * Turn Cloud Backup on for this device via the Display sheet's toggle (no
 * pairing code involved -- see turnOnBackup() in index.html). Waits for
 * anonymous auth to resolve first: turnOnBackup() no-ops with a "Couldn't
 * connect" toast while authUid is still null, which is the whole first second
 * of every boot. Returns true once the toggle reads "on". Leaves the Display
 * sheet open.
 */
async function enableBackupViaToggle(page) {
  for (let i = 0; i < 20; i++) {
    if ((await storage.readKey(page, storage.KEYS.authUid)).raw) break;
    await page.waitForTimeout(500);
  }
  await openDisplaySheet(page);
  await cloudBackupToggle(page).click({ timeout: config.actionTimeoutMs });
  for (let i = 0; i < 8; i++) {
    if (((await cloudBackupToggle(page).getAttribute("class")) || "").includes(" on")) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

/**
 * From the link-device menu step, generate a code and return it once shown.
 * On a device that hasn't backed up yet, the menu step only offers "Turn on
 * backup" (see turnOnBackup() in index.html) -- tapping it flips cloudSync
 * on synchronously and re-renders this same step in place as the "already
 * backing up" state, whose primary button is "Show a code to link another
 * device". So on a fresh device this is a two-tap sequence; on an
 * already-enabled device the first tap is skipped.
 */
async function generateLinkCode(page) {
  const turnOnBtn = linkDeviceSheet(page).locator(".sheet-btn.primary", { hasText: "Turn on backup" });
  if (await turnOnBtn.count()) {
    await turnOnBtn.click({ timeout: config.actionTimeoutMs });
    await linkDeviceSheet(page)
      .locator(".sheet-btn.primary", { hasText: "Show a code to link another device" })
      .waitFor({ state: "visible", timeout: config.actionTimeoutMs });
  }
  await linkDeviceSheet(page)
    .locator(".sheet-btn", { hasText: "Show a code to link another device" })
    .click({ timeout: config.actionTimeoutMs });
  await linkDeviceSheet(page).locator(".join-code").waitFor({ state: "visible", timeout: config.actionTimeoutMs });
  return (await linkDeviceSheet(page).locator(".join-code").textContent()).trim();
}

/**
 * From the link-device menu step, switch to the code-entry step and redeem
 * `code`. A valid code now takes two taps of "Link →": the first looks up
 * the code and advances to a "join <ownerName>'s group?" confirmation
 * (SECURITY_REVIEW.md #11b), the second commits the join. An invalid/expired
 * code never advances past the first tap -- the sheet stays on the entry
 * step showing an error instead -- so only tap again if the confirm step
 * actually appeared.
 */
async function redeemLinkCode(page, code) {
  await linkDeviceSheet(page)
    .locator(".sheet-btn", { hasText: "Enter a code from another device" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
  await page.locator('input[aria-label="Link code"]').fill(code);
  await linkDeviceSheet(page).locator(".sheet-btn.primary", { hasText: "Link →" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(300);
  const confirmStep = linkDeviceSheet(page).locator("h3", { hasText: "Join This Group?" });
  if (await confirmStep.count()) {
    await linkDeviceSheet(page).locator(".sheet-btn.primary", { hasText: "Link →" }).click({ timeout: config.actionTimeoutMs });
    await page.waitForTimeout(400);
  }
}

async function linkErrorText(page) {
  const err = linkDeviceSheet(page).locator(".join-error");
  if ((await err.count()) === 0) return null;
  return (await err.textContent()).trim();
}

/** Closes the "show code" step's sheet via its Done button. */
async function closeLinkDeviceSheet(page) {
  await linkDeviceSheet(page).locator(".sheet-btn.ghost", { hasText: "Done" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

/**
 * Full unlink: from an already-backed-up device, open Display -> Cloud Backup
 * menu, tap "Turn off backup & unlink", then confirm. Lands back on the open
 * Display sheet (whose entry has reverted to "Back up my History"), which this
 * closes so the overlay doesn't block later clicks.
 */
async function unlinkThisDevice(page) {
  await openDisplaySheet(page);
  await openLinkDeviceSheet(page);
  await linkDeviceSheet(page)
    .locator(".sheet-btn", { hasText: "Turn off backup & unlink" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
  await linkDeviceSheet(page)
    .locator(".sheet-btn", { hasText: /^Turn off backup$/ })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(config.syncSettleMs);
  // Back on the Display sheet -- close it via Done.
  await displaySheet(page).locator(".sheet-btn.ghost", { hasText: "Done" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

/**
 * Full happy-path handshake: device A opens the Display sheet, backs up its
 * History (generating a link code); device B redeems it. Returns the code.
 * Device A's "show code" sheet is left open by generateLinkCode() (there's no
 * auto-close on redemption -- it's a two-device handshake, not a live-updating
 * view) so this closes it explicitly once B is done, otherwise its overlay
 * blocks every subsequent click on device A.
 */
async function linkDevices(deviceA, deviceB) {
  await openDisplaySheet(deviceA.page);
  await openLinkDeviceSheet(deviceA.page);
  const code = await generateLinkCode(deviceA.page);
  await deviceA.page.waitForTimeout(config.syncSettleMs);

  await openDisplaySheet(deviceB.page);
  await openLinkDeviceSheet(deviceB.page);
  await redeemLinkCode(deviceB.page, code);
  await deviceB.page.waitForTimeout(config.syncSettleMs);

  await closeLinkDeviceSheet(deviceA.page);
  return code;
}

module.exports = {
  openDisplaySheet,
  displaySheet,
  openLinkDeviceSheet,
  cloudBackupToggle,
  enableBackupViaToggle,
  linkDeviceSheet,
  generateLinkCode,
  redeemLinkCode,
  linkErrorText,
  closeLinkDeviceSheet,
  unlinkThisDevice,
  linkDevices,
  waitForLinkedUid,
};

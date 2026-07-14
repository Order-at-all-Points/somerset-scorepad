"use strict";
const config = require("../../config");

/** Opens the Display sheet (gear/menu icon), the entry point for device linking. */
async function openDisplaySheet(page) {
  await page.locator("#menuBtn").click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

function displaySheet(page) {
  return page.locator('[role="dialog"][aria-label="Display settings"]');
}

/** From the open Display sheet, tap "Back up my History" / "Cloud backup: On". */
async function openLinkDeviceSheet(page) {
  await displaySheet(page)
    .locator(".sheet-btn", { hasText: /Back up my History|Cloud backup: On/ })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

function linkDeviceSheet(page) {
  return page.locator('[role="dialog"][aria-label="Link this device"]');
}

/** From the link-device menu step, generate a code and return it once shown. */
async function generateLinkCode(page) {
  await linkDeviceSheet(page)
    .locator(".sheet-btn", { hasText: "Show a code to link this device" })
    .click({ timeout: config.actionTimeoutMs });
  await linkDeviceSheet(page).locator(".join-code").waitFor({ state: "visible", timeout: config.actionTimeoutMs });
  return (await linkDeviceSheet(page).locator(".join-code").textContent()).trim();
}

/** From the link-device menu step, switch to the code-entry step and redeem `code`. */
async function redeemLinkCode(page, code) {
  await linkDeviceSheet(page)
    .locator(".sheet-btn", { hasText: "Enter a code from another device" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
  await page.locator('input[aria-label="Link code"]').fill(code);
  await linkDeviceSheet(page).locator(".sheet-btn.primary", { hasText: "Link →" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(400);
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
  linkDeviceSheet,
  generateLinkCode,
  redeemLinkCode,
  linkErrorText,
  closeLinkDeviceSheet,
  linkDevices,
};

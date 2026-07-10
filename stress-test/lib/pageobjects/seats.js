"use strict";
const config = require("../../config");

/** Tap seat `seatIdx` (0-3) on the Game tab's dealer table and set its player name. */
async function nameSeat(page, seatIdx, name) {
  await page.locator(".seat:visible").nth(seatIdx).click({ timeout: config.actionTimeoutMs });
  await page.locator(".sheet-btn", { hasText: "Edit name" }).click();
  const input = page.locator('.sheet-input[aria-label="Player name"]');
  await input.waitFor({ state: "visible", timeout: config.actionTimeoutMs });
  await input.fill(name);
  await page.locator(".sheet-btn.primary", { hasText: "Save" }).click();
  await page.waitForTimeout(60);
}

async function nameAllSeats(page, names) {
  for (let i = 0; i < names.length; i++) {
    await nameSeat(page, i, names[i]);
  }
}

module.exports = { nameSeat, nameAllSeats };

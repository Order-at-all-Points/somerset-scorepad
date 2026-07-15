"use strict";
const config = require("../../config");

/** e.g. "Round 1 Match", "Winners · Round 2 Match", "Grand Final", "Game 3 - Best of 5 Match". */
async function viewHeadText(page) {
  const head = page.locator(".view-head:visible");
  if ((await head.count()) === 0) return null;
  return (await head.first().textContent()).trim();
}

async function backToBracket(page) {
  await page.locator(".link-btn:visible", { hasText: "Back to bracket" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(100);
}

module.exports = { viewHeadText, backToBracket };

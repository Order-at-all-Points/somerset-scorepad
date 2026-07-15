"use strict";
const config = require("../../config");

async function goto(page, tab) {
  await page.locator("nav#nav button.nav-btn", { hasText: tab }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

async function activeTab(page) {
  return page.locator("nav#nav button.nav-btn.on").textContent();
}

module.exports = { goto, activeTab };

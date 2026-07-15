"use strict";
const config = require("../../config");

async function groupHeaders(page) {
  return page.locator(".hist-date-head .hist-date-title").allTextContents();
}

async function entryIds(page) {
  return page.locator(".hist-entry").evaluateAll((els) => els.map((e) => e.getAttribute("data-rec-id")));
}

function entryLocator(page, recId) {
  return page.locator(`.hist-entry[data-rec-id="${recId}"]`);
}

async function expandEntry(page, recId) {
  await entryLocator(page, recId).locator(".hist-item").click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(60);
}

async function deleteEntry(page, recId) {
  await expandEntry(page, recId);
  await entryLocator(page, recId)
    .locator(".hist-del .link-btn.danger", { hasText: "Delete this game" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(80);
}

async function undoToastVisible(page) {
  return (await page.locator(".undo-toast").count()) > 0;
}

async function clickUndo(page) {
  await page.locator(".undo-toast button", { hasText: "Undo" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(80);
}

/** Generic ui.info popup (used for import success/failure messages, among other things). */
async function infoModalText(page) {
  const p = page.locator('[role="dialog"][aria-label="Hand detail"] p.disp');
  if ((await p.count()) === 0) return null;
  return (await p.textContent()).trim();
}

async function dismissInfoModal(page) {
  const btn = page.locator('[role="dialog"][aria-label="Hand detail"] .sheet-btn.primary');
  if ((await btn.count()) === 0) return false;
  await btn.click();
  await page.waitForTimeout(60);
  return true;
}

/**
 * Click "Back up" and capture the exported JSON via Playwright's download
 * event (navigator.share is neutralized in browser.js so this always takes
 * the deterministic <a download> blob path). Returns the parsed
 * { exportedAt, games } object plus the raw download path.
 */
async function exportHistory(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: config.actionTimeoutMs }),
    page.locator(".history-footer .link-btn", { hasText: "Back up" }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  await new Promise((resolve, reject) => {
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  const text = Buffer.concat(chunks).toString("utf8");
  return { parsed: JSON.parse(text), raw: text, suggestedFilename: download.suggestedFilename() };
}

/** Import a backup file (already on disk at `filePath`) via the hidden file input. */
async function importHistoryFile(page, filePath) {
  await page.locator('input[type="file"][accept="application/json"]').setInputFiles(filePath);
  await page.waitForTimeout(150);
  return infoModalText(page);
}

module.exports = {
  groupHeaders,
  entryIds,
  expandEntry,
  deleteEntry,
  undoToastVisible,
  clickUndo,
  infoModalText,
  dismissInfoModal,
  exportHistory,
  importHistoryFile,
};

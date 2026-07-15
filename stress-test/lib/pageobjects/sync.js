"use strict";
const config = require("../../config");
const nav = require("./nav");
const tSetup = require("./tournamentSetup");

/** Bracket/series view's "Share this tournament →" / "Share this series →" link. Opens the Share sheet. */
async function shareFromBracket(page) {
  await page
    .locator(".link-btn:visible", { hasText: /Share this (tournament|series) →/ })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(400); // Firebase write round trip before the share sheet/code appears
}

/**
 * Game tab Options sheet's "Share this game" entry (wraps the solo game into
 * a 1-off series). Even when all 4 seats are already named, this routes
 * through a "Who's playing?" confirm sheet (`ui.shareNamesSetup`, pre-filled
 * from the current seat names) before the actual share -- the "Share →"
 * button only fires `startGameShare()` once every name is non-empty.
 */
async function shareFromGameOptions(page) {
  await page.locator("#gameOptionsToggle:visible").click();
  await page.locator(".sheet-btn", { hasText: "Share this game" }).click();
  await page.waitForTimeout(80);
  const confirmSheet = page.locator('[role="dialog"][aria-label="Who\'s playing"]');
  if (await confirmSheet.count()) {
    await confirmSheet.locator(".sheet-btn.primary", { hasText: "Share" }).click({ timeout: config.actionTimeoutMs });
  }
  await page.waitForTimeout(400);
}

function shareSheet(page) {
  return page.locator('[role="dialog"][aria-label="Share"]');
}

async function readJoinCode(page) {
  await shareSheet(page).locator(".join-code").waitFor({ state: "visible", timeout: config.actionTimeoutMs });
  return (await shareSheet(page).locator(".join-code").textContent()).trim();
}

async function shareErrorText(page) {
  const err = page.locator(".sync-error:visible, [class*='syncError']:visible");
  if ((await err.count()) === 0) return null;
  return (await err.first().textContent()).trim();
}

/** From the open Share sheet, open the roster identity picker. */
async function openWhoSheetFromShare(page) {
  await shareSheet(page)
    .locator(".sheet-btn", { hasText: /Who am I playing as\?|Playing as: .* · Change/ })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(80);
}

function whoSheet(page) {
  return page.locator('[role="dialog"][aria-label="Identify yourself"]');
}

async function chooseIdentity(page, name) {
  await whoSheet(page)
    .locator(".sheet-btn", { hasText: name })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(80);
}

async function clearIdentity(page) {
  await whoSheet(page)
    .locator(".sheet-btn", { hasText: "Not playing / clear" })
    .click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(80);
}

/**
 * From an open Share sheet, tag this device as `name`. Note: opening the
 * identity picker from the Share sheet closes the Share sheet itself
 * (`ui.shareSheetOpen = false`) -- picking a name returns straight to the
 * bracket view, there's no Share sheet left to close afterward.
 */
async function identifyFromShareSheet(page, name) {
  await openWhoSheetFromShare(page);
  await chooseIdentity(page, name);
}

async function closeShareSheet(page) {
  await shareSheet(page).locator(".sheet-btn.ghost", { hasText: "Done" }).click();
  await page.waitForTimeout(60);
}

async function joinWithCode(page, code) {
  await page.locator('input[aria-label="Join code"]').fill(code);
  await page.locator(".sheet-btn.primary", { hasText: "Join →" }).click({ timeout: config.actionTimeoutMs });
  await page.waitForTimeout(400);
}

async function joinErrorText(page) {
  const err = page.locator(".join-error");
  if ((await err.count()) === 0) return null;
  return (await err.textContent()).trim();
}

/** { dot: "live"|"connecting"|"error"|"offline"|null, label: string|null } */
async function syncStatus(page) {
  const dot = page.locator(".sync-dot:visible");
  const label = page.locator(".sync-label:visible");
  if ((await dot.count()) === 0) return { dot: null, label: null };
  const cls = (await dot.first().getAttribute("class")) || "";
  const dotClass = cls.replace("sync-dot", "").trim().split(/\s+/)[0] || null;
  const labelText = (await label.count()) ? (await label.first().textContent()).trim() : null;
  return { dot: dotClass, label: labelText };
}

async function waitForSyncLabel(page, expected, timeout = config.syncSettleMs) {
  await page
    .locator(".sync-label:visible", { hasText: expected })
    .waitFor({ state: "visible", timeout })
    .catch(() => {});
  return syncStatus(page);
}

/**
 * The standard two-device handshake for an already-started tournament/series:
 * host shares from the bracket view and identifies as hostName; guest opens
 * the join sheet, joins with the minted code, and identifies as guestName if
 * prompted. Returns the join code, or null after recording a critical finding
 * when the join failed (callers should bail out on null).
 */
async function connectGuest(host, guest, { hostName, guestName, logger }) {
  await shareFromBracket(host.page);
  const code = await readJoinCode(host.page);
  await identifyFromShareSheet(host.page, hostName);

  await nav.goto(guest.page, "Tournament");
  await tSetup.openJoinSheet(guest.page);
  await joinWithCode(guest.page, code);
  const joinErr = await joinErrorText(guest.page);
  if (joinErr) {
    await logger.record({
      severity: "critical",
      category: "sync-divergence",
      summary: `Guest failed to join with a fresh code: ${joinErr}`,
      page: guest.page,
      contextLabel: "guest",
    });
    return null;
  }
  // The forced "Identify yourself" prompt only renders once the joined
  // tournament's first snapshot adopts, which races the join round-trip —
  // sampling count() instantly can miss it, and the sheet then blocks every
  // later click. Give it a moment to appear before deciding.
  await whoSheet(guest.page).waitFor({ state: "visible", timeout: 1500 }).catch(() => {});
  if (await whoSheet(guest.page).count()) {
    await chooseIdentity(guest.page, guestName);
  }
  return code;
}

/** The per-hand lock-contention banner shown to a second device viewing a hand someone else has open. */
async function viewOnlyBarText(page) {
  const bar = page.locator(".view-only-bar:visible");
  if ((await bar.count()) === 0) return null;
  return (await bar.first().textContent()).trim();
}

module.exports = {
  shareFromBracket,
  shareFromGameOptions,
  shareSheet,
  readJoinCode,
  shareErrorText,
  openWhoSheetFromShare,
  whoSheet,
  chooseIdentity,
  clearIdentity,
  identifyFromShareSheet,
  closeShareSheet,
  joinWithCode,
  joinErrorText,
  connectGuest,
  syncStatus,
  waitForSyncLabel,
  viewOnlyBarText,
};

"use strict";
const config = require("../../config");

/**
 * Drive a `.stepper` (bid / points-taken) to an exact value via its +/-
 * buttons. Free-typing the input only fires the app's onChange on blur,
 * whereas the +/- buttons call onChange synchronously per click, which is
 * the more deterministic path across re-renders.
 *
 * `scope` is anything with a `.locator()` method -- a Page, or (preferred,
 * to avoid matching a stale hidden copy of the scorepad on another tab) a
 * Locator already narrowed to the live `.entry:visible` container.
 */
async function setStepper(scope, label, target) {
  const input = scope.locator(`.stepper input[aria-label="${label}"]`);
  await input.waitFor({ state: "visible", timeout: config.actionTimeoutMs });
  const decBtn = scope.locator(`.stepper button.step[aria-label="Decrease ${label}"]`);
  const incBtn = scope.locator(`.stepper button.step[aria-label="Increase ${label}"]`);
  let current = parseInt(await input.inputValue(), 10);
  if (Number.isNaN(current)) throw new Error(`stepper "${label}" has non-numeric value`);
  let guard = 0;
  while (current !== target && guard < 40) {
    if (current < target) {
      await incBtn.click();
      current++;
    } else {
      await decBtn.click();
      current--;
    }
    guard++;
  }
  const finalVal = parseInt(await input.inputValue(), 10);
  if (finalVal !== target) {
    throw new Error(`stepper "${label}" ended at ${finalVal}, expected ${target} (${guard} clicks)`);
  }
  return finalVal;
}

/** Any bottom-sheet / modal dialog currently open in #modalRoot. */
async function openDialogLabel(page) {
  const dlg = page.locator("#modalRoot [role='dialog']");
  if ((await dlg.count()) === 0) return null;
  return dlg.first().getAttribute("aria-label");
}

async function waitForNoDialog(page, timeout = config.actionTimeoutMs) {
  await page.locator("#modalRoot [role='dialog']").waitFor({ state: "detached", timeout }).catch(() => {});
}

function parseScores(strs) {
  return strs.map((s) => parseInt(s, 10));
}

module.exports = { setStepper, openDialogLabel, waitForNoDialog, parseScores };

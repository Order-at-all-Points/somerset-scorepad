"use strict";
const config = require("../config");

const APP_URL = `http://127.0.0.1:${config.serverPort}/index.html`;

// Serializes new-device creation so every boot-time signInAnonymously() call
// is spaced at least config.authThrottleMs apart, even when multiple workers
// call createDevice() concurrently (local phase) or back-to-back (sync phase)
// -- see config.js's authThrottleMs comment for why this exists. Chaining off
// a single shared promise means each caller waits for the previous slot to be
// claimed before computing its own wait, so concurrent callers still queue in
// order rather than all computing the same "no wait needed yet" answer at once.
let authGateChain = Promise.resolve(0);
function waitForAuthSlot() {
  authGateChain = authGateChain.then(async (prevSlotAt) => {
    const wait = Math.max(0, prevSlotAt + config.authThrottleMs - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return Date.now();
  });
  return authGateChain;
}

async function launchBrowser(browserName = "chromium") {
  const playwright = require("playwright");
  const launcher = playwright[browserName];
  if (!launcher) throw new Error(`Unknown browser: ${browserName}`);
  return launcher.launch({ headless: config.headless });
}

/**
 * Create an isolated BrowserContext (own localStorage/deviceId -- simulates
 * one phone) wired so console errors and uncaught page exceptions become
 * findings automatically, no per-scenario boilerplate needed.
 */
async function createDevice(browser, { label, scenarioLogger, severity = "high" } = {}) {
  const context = await browser.newContext();
  // Keep the harness deterministic: don't let the app's service worker start
  // caching responses out from under our controlled static server between runs.
  await context.addInitScript(() => {
    try {
      if (navigator.serviceWorker) {
        navigator.serviceWorker.register = () => Promise.reject(new Error("disabled for stress test"));
      }
    } catch (e) {
      /* ignore on browsers where serviceWorker is non-configurable */
    }
    try {
      // Force History export down the deterministic <a download> blob path
      // (Playwright can capture that via the `download` event) instead of
      // the native OS share sheet, which varies by browser/platform and
      // can't be driven headlessly.
      navigator.share = undefined;
      navigator.canShare = undefined;
    } catch (e) {
      /* ignore on browsers where these are non-configurable */
    }
  });

  const page = await context.newPage();

  if (scenarioLogger) {
    page.on("pageerror", (err) => {
      scenarioLogger.record({
        severity,
        category: "console-error",
        summary: `Uncaught page error (${label || "page"}): ${err.message}`,
        actual: err.stack || err.message,
        page,
        contextLabel: label,
      });
    });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      // The app probes for Vercel Analytics/Speed-Insights (window.va/si,
      // loaded from /_vercel/...) which only exist when actually deployed on
      // Vercel's edge -- 404s for them here are an artifact of our local
      // static server, not an app bug, on every single page load.
      const loc = msg.location();
      if (loc && loc.url && loc.url.includes("/_vercel/")) return;
      // Deliberate context.setOffline(true) in offline/reconnect scenarios
      // makes Chrome itself log ERR_INTERNET_DISCONNECTED for in-flight
      // requests -- that's Playwright faithfully simulating "no network,"
      // not an app bug.
      if (msg.text().includes("ERR_INTERNET_DISCONNECTED")) return;
      scenarioLogger.record({
        severity: "medium",
        category: "console-error",
        summary: `Console error (${label || "page"}): ${msg.text()}`,
        actual: msg.text(),
        page,
        contextLabel: label,
      });
    });
  }

  await waitForAuthSlot();
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.locator("nav#nav button.nav-btn").first().waitFor({ state: "visible", timeout: config.actionTimeoutMs });

  return { context, page, label: label || "device" };
}

async function closeDevice(device) {
  try {
    await device.context.close();
  } catch (e) {
    /* already closed */
  }
}

module.exports = { APP_URL, launchBrowser, createDevice, closeDevice };

"use strict";
const browserLib = require("../lib/browser");
const nav = require("../lib/pageobjects/nav");
const tSetup = require("../lib/pageobjects/tournamentSetup");
const seats = require("../lib/pageobjects/seats");
const sync = require("../lib/pageobjects/sync");
const handEntry = require("../lib/pageobjects/handEntry");
const dealHistory = require("../lib/pageobjects/dealHistory");
const newGame = require("../lib/pageobjects/newGame");
const config = require("../config");

const invalidJoinCode = {
  name: "sync-cross-cutting/invalid-join-code",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("sync-cross-cutting/invalid-join-code");
    const device = await browserLib.createDevice(browser, { label: "solo", scenarioLogger: logger });
    try {
      await nav.goto(device.page, "Tournament");
      await tSetup.openJoinSheet(device.page);
      // Give Firebase's connection plenty of time to establish first, so a
      // slow-connecting SDK on a fresh page load can't be blamed for what
      // this actually reproduces (checked directly: waiting up to 3s longer
      // doesn't change the outcome).
      await device.page.waitForTimeout(1500);
      await sync.joinWithCode(device.page, "ZZZZZZ");
      const err = await sync.joinErrorText(device.page);
      if (!err || !/no tournament found/i.test(err)) {
        // Root cause (from FIREBASE_SETUP.md's published security rules):
        // `.read` is `"data.exists() && (now - data.child('_createdAt').val()) < 172800000"`.
        // For a code that has never existed, `data.exists()` is false, so the
        // rule short-circuits to `false` -- Firebase denies the read as a
        // permission error rather than returning `data == null`. That means
        // joinTournament()'s own `if (!data) { onError("No tournament found
        // with that code.") }` branch (index.html ~1710) is unreachable in
        // practice: the `.catch()` for a network/permission failure fires
        // first, always surfacing "Couldn't connect. Check your internet
        // connection." -- which is actively misleading for a simply
        // mistyped or expired code (nothing is actually wrong with the
        // user's connection).
        await logger.record({
          severity: "medium",
          category: "correctness",
          summary: `Joining with a nonexistent code always shows "Couldn't connect. Check your internet connection." instead of "No tournament found with that code." -- the security rules deny reads to nonexistent paths as a permission error, so that friendlier branch in joinTournament() is dead code`,
          expected: 'a "No tournament found with that code." message',
          actual: err,
          page: device.page,
        });
      }
    } catch (e) {
      await logger.record({
        severity: "high",
        category: "scenario-crash",
        summary: `Scenario threw: ${e.message}`,
        actual: e.stack,
        page: device.page,
      });
    } finally {
      await browserLib.closeDevice(device);
    }
  },
};

async function setUpSharedNamedGame(host, guest, logger) {
  await seats.nameAllSeats(host.page, ["L1", "L2", "L3", "L4"]);
  await sync.shareFromGameOptions(host.page);
  const code = await sync.readJoinCode(host.page);
  await sync.identifyFromShareSheet(host.page, "L1");
  await nav.goto(guest.page, "Tournament");
  await tSetup.openJoinSheet(guest.page);
  await sync.joinWithCode(guest.page, code);
  await guest.page.waitForTimeout(300);
  if (await guest.page.locator('[role="dialog"][aria-label="Identify yourself"]').count()) {
    await sync.chooseIdentity(guest.page, "L3");
  }
  await nav.goto(guest.page, "Game");
  await guest.page.waitForTimeout(config.syncSettleMs);
}

const concurrentDifferentHands = {
  name: "sync-cross-cutting/concurrent-different-hands-no-conflict",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("sync-cross-cutting/concurrent-different-hands-no-conflict");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    try {
      await setUpSharedNamedGame(host, guest, logger);

      logger.step("Host records 2 deals to establish history");
      await handEntry.playDeal(host.page, { bidder: { seat: 0 }, bid: 8, pointsTaken: 8 });
      await handEntry.playDeal(host.page, { bidder: { seat: 1 }, bid: 7, pointsTaken: 7 });
      await guest.page.waitForTimeout(config.syncSettleMs);
      await nav.goto(guest.page, "Game"); // force a re-render pass to pick up synced deals

      logger.step("Host opens Edit on deal 1, guest opens Edit on deal 2 at the same time");
      await dealHistory.editDeal(host.page, 1);
      await dealHistory.editDeal(guest.page, 2);

      const hostLocked = await sync.viewOnlyBarText(host.page);
      const guestLocked = await sync.viewOnlyBarText(guest.page);
      if (hostLocked || guestLocked) {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Editing two DIFFERENT hands concurrently should not lock-contend, but saw a view-only bar (host="${hostLocked}", guest="${guestLocked}")`,
          expected: "neither device blocked",
          actual: { hostLocked, guestLocked },
          pages: { host: host.page, guest: guest.page },
        });
      }
      // Both should still be able to complete their edits.
      await handEntry.goToStep2(host.page);
      await handEntry.submitDeal(host.page);
      await handEntry.goToStep2(guest.page);
      await handEntry.submitDeal(guest.page);
    } catch (e) {
      await logger.record({
        severity: "high",
        category: "scenario-crash",
        summary: `Scenario threw: ${e.message}`,
        actual: e.stack,
        pages: { host: host.page, guest: guest.page },
      });
    } finally {
      await browserLib.closeDevice(host);
      await browserLib.closeDevice(guest);
    }
  },
};

const concurrentSameHand = {
  name: "sync-cross-cutting/concurrent-same-hand-lock-contention",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("sync-cross-cutting/concurrent-same-hand-lock-contention");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    try {
      await setUpSharedNamedGame(host, guest, logger);

      logger.step("Host opens Record Deal 1 (claims the new-hand lock)");
      await handEntry.openNewDeal(host.page);
      await guest.page.waitForTimeout(config.syncSettleMs);
      await nav.goto(guest.page, "Game");

      logger.step("Guest tries to open the same Record Deal 1 slot");
      const guestState = await handEntry.recordDealState(guest.page);
      if (guestState.state !== "locked") {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Guest should see the hand as locked while host has "Record Deal 1" open, but saw state="${guestState.state}"`,
          expected: "locked",
          actual: guestState,
          pages: { host: host.page, guest: guest.page },
        });
      }

      logger.step("Host cancels (from Step 1, before ever advancing to Step 2); guest should regain access");
      await handEntry.cancelEntry(host.page);
      await guest.page.waitForTimeout(config.syncSettleMs);
      await nav.goto(guest.page, "Game");
      const guestStateAfter = await handEntry.recordDealState(guest.page);
      if (guestStateAfter.state !== "ready") {
        // Root cause (confirmed directly against index.html): releaseLock(key)
        // (~line 1288) does `delete tourney.locks[key]` but never calls
        // saveTourney() -- unlike claimLock, which explicitly does. Step 1's
        // Cancel button (~line 3251) calls releaseMyHandLock() then, since
        // game.pendingBid is only set once you've advanced past Step 1 at
        // least once, takes the `else softRender()` branch instead of
        // `persist()` -- so the release never reaches localStorage or
        // Firebase. The lock is cleared from THIS device's in-memory `tourney`
        // (so the same device can immediately reopen it) but every other
        // device -- and this same device after a reload -- still sees the
        // stale lock entry until it naturally expires after LOCK_TIMEOUT_MS
        // (10 minutes). Confirmed via storage: `tourney.locks` still contains
        // the entry, unchanged, on the host's own device immediately after
        // clicking Cancel.
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary:
            "Canceling a hand entry from Step 1 (without ever advancing to Step 2) releases the per-hand lock only in memory, not in storage/Firebase -- other devices (and this device after a reload) stay locked out of that hand for up to the 10-minute stale-lock timeout",
          expected: "ready",
          actual: guestStateAfter,
          pages: { host: host.page, guest: guest.page },
        });
      }
    } catch (e) {
      await logger.record({
        severity: "high",
        category: "scenario-crash",
        summary: `Scenario threw: ${e.message}`,
        actual: e.stack,
        pages: { host: host.page, guest: guest.page },
      });
    } finally {
      await browserLib.closeDevice(host);
      await browserLib.closeDevice(guest);
    }
  },
};

const offlineReconnect = {
  name: "sync-cross-cutting/offline-then-reconnect",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("sync-cross-cutting/offline-then-reconnect");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    try {
      await setUpSharedNamedGame(host, guest, logger);

      const healthyStatus = await sync.syncStatus(host.page);
      if (healthyStatus.label !== "Live") {
        await logger.record({
          severity: "medium",
          category: "sync-divergence",
          summary: `Sync label wasn't "Live" during otherwise-healthy play (got "${healthyStatus.label}")`,
          expected: "Live",
          actual: healthyStatus.label,
          page: host.page,
        });
      }

      logger.step("Host goes offline");
      await host.context.setOffline(true);
      await host.page.waitForTimeout(1500);
      const offlineStatus = await sync.syncStatus(host.page);
      logger.step(`Sync status while offline: ${JSON.stringify(offlineStatus)}`);
      if (offlineStatus.label === "Live") {
        await logger.record({
          severity: "medium",
          category: "sync-divergence",
          summary: 'Sync label still reads "Live" after the device went offline (navigator.onLine-based check)',
          expected: "not Live",
          actual: offlineStatus.label,
          page: host.page,
        });
      }

      logger.step("Host plays a deal while offline (should still work locally)");
      await handEntry.playDeal(host.page, { bidder: { seat: 0 }, bid: 8, pointsTaken: 8 });
      const totalsWhileOffline = await newGame.readTeamTotals(host.page);
      logger.step(`Host totals while offline: ${totalsWhileOffline}`);

      logger.step("Host reconnects");
      await host.context.setOffline(false);
      await host.page.waitForTimeout(config.syncSettleMs);
      const reconnectedStatus = await sync.waitForSyncLabel(host.page, "Live", config.syncSettleMs);
      if (reconnectedStatus.label !== "Live") {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Sync did not recover to "Live" after reconnecting (got "${reconnectedStatus.label}")`,
          expected: "Live",
          actual: reconnectedStatus.label,
          page: host.page,
        });
      }

      await guest.page.waitForTimeout(config.syncSettleMs);
      await nav.goto(guest.page, "Game");
      const guestTotals = await newGame.readTeamTotals(guest.page);
      if (guestTotals[0] !== totalsWhileOffline[0] || guestTotals[1] !== totalsWhileOffline[1]) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Guest didn't pick up the deal host recorded while offline after reconnecting (host=${totalsWhileOffline}, guest=${guestTotals})`,
          expected: totalsWhileOffline,
          actual: guestTotals,
          pages: { host: host.page, guest: guest.page },
        });
      }
    } catch (e) {
      await logger.record({
        severity: "high",
        category: "scenario-crash",
        summary: `Scenario threw: ${e.message}`,
        actual: e.stack,
        pages: { host: host.page, guest: guest.page },
      });
    } finally {
      await browserLib.closeDevice(host);
      await browserLib.closeDevice(guest);
    }
  },
};

module.exports = [invalidJoinCode, concurrentDifferentHands, concurrentSameHand, offlineReconnect];

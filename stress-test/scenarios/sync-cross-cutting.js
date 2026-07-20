"use strict";
const browserLib = require("../lib/browser");
const nav = require("../lib/pageobjects/nav");
const tSetup = require("../lib/pageobjects/tournamentSetup");
const seats = require("../lib/pageobjects/seats");
const sync = require("../lib/pageobjects/sync");
const handEntry = require("../lib/pageobjects/handEntry");
const dealHistory = require("../lib/pageobjects/dealHistory");
const newGame = require("../lib/pageobjects/newGame");
const bracket = require("../lib/pageobjects/bracket");
const storage = require("../lib/pageobjects/storage");
const seriesSetup = require("../lib/pageobjects/seriesSetup");
const simulator = require("../lib/simulator");
const config = require("../config");

// Deterministic 5-deal script: seat 0's team wins 10-0 each hand, reaching
// exactly 50. Clinches a game on a known deal count without a random seed.
const TEAM0_WIN_SCRIPT = Array.from({ length: 5 }, () => ({ bidder: { seat: 0 }, bid: 10, pointsTaken: 10 }));

// Host shares a Game-tab game; guest joins and chooses to SPECTATE (name = null).
// Returns the join code. Leaves the guest on the Game tab with the shared
// session persisted (tourney + sync-code keys) so a reload exercises the
// boot-time reconnect path.
async function setUpSpectatedGame(host, guest) {
  await seats.nameAllSeats(host.page, ["P1", "P2", "P3", "P4"]);
  await sync.shareFromGameOptions(host.page);
  const code = await sync.readJoinCode(host.page);
  await sync.identifyFromShareSheet(host.page, "P1");
  await nav.goto(guest.page, "Tournament");
  await tSetup.openJoinSheet(guest.page);
  await sync.joinWithCode(guest.page, code);
  await sync.whoSheet(guest.page).waitFor({ state: "visible", timeout: 1500 }).catch(() => {});
  if (await sync.whoSheet(guest.page).count()) {
    await sync.spectate(guest.page);
  }
  await nav.goto(guest.page, "Game");
  await guest.page.waitForTimeout(config.syncSettleMs);
  return code;
}

async function reloadAndBoot(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("nav#nav button.nav-btn").first().waitFor({ state: "visible" });
}

// A spectator whose watched game has finished must not have the old finished
// game reappear as "in progress" the next time they open the app. Nobody hands
// a spectator the Continue/New Game teardown, so the boot-time reconnect must
// clear their stale session itself once the watched game/series is terminal.
const spectatorClearsFinishedOnReload = {
  name: "sync-cross-cutting/spectator-clears-finished-game-on-reload",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("sync-cross-cutting/spectator-clears-finished-game-on-reload");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    try {
      await setUpSpectatedGame(host, guest);

      // Sanity: while the game is live, the spectator really is holding the
      // shared session (otherwise the reload assertion below proves nothing).
      const beforeCode = (await storage.readKey(guest.page, storage.KEYS.syncCode)).raw;
      if (!beforeCode) {
        await logger.record({
          severity: "high",
          category: "test-setup",
          summary: "Spectator never persisted a sync code while watching a live game -- setup precondition failed",
          page: guest.page,
          contextLabel: "guest",
        });
        return;
      }

      logger.step("Host finishes the shared game (no Continue tap)");
      await simulator.playGameWithScriptedDeals(host.page, TEAM0_WIN_SCRIPT, { logger, contextLabel: "host" });
      await guest.page.waitForTimeout(config.syncSettleMs);

      logger.step("Spectator reopens the app (reload) -- the finished game must NOT resume");
      await reloadAndBoot(guest.page);
      await guest.page.waitForTimeout(1500);

      const tourneyAfter = (await storage.readKey(guest.page, storage.KEYS.tournament)).value;
      const codeAfter = (await storage.readKey(guest.page, storage.KEYS.syncCode)).raw;
      if (tourneyAfter !== null || codeAfter !== null) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary: `Spectator's finished shared game did not clear on reopen -- the old game resumes as "in progress" (tourney ${tourneyAfter === null ? "null" : "present"}, syncCode ${codeAfter === null ? "null" : JSON.stringify(codeAfter)}) -- regresses "clear a spectator's stale session at terminal state"`,
          expected: "tourney and syncCode both cleared on reopen",
          actual: { tourneyCleared: tourneyAfter === null, syncCode: codeAfter },
          page: guest.page,
          contextLabel: "guest",
        });
      }
      // And the Game tab should show a fresh, empty pad -- no synced deals.
      await nav.goto(guest.page, "Game");
      const dealRows = await guest.page.locator(".deal-row:visible, .hist-hand:visible").count();
      if (dealRows > 0) {
        await logger.record({
          severity: "high",
          category: "regression-repro",
          summary: `After reopening, the spectator's Game tab still shows ${dealRows} deal row(s) from the finished shared game instead of a fresh empty pad`,
          expected: 0,
          actual: dealRows,
          page: guest.page,
          contextLabel: "guest",
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

// The mirror-image guard: a spectator must NOT be cleared mid-series. Between
// games of a multi-game series (one game done, the next queued, champion still
// null) the session is very much alive, and an over-eager teardown would drop
// the spectator out of a series still in progress.
const spectatorResumesMidSeries = {
  name: "sync-cross-cutting/spectator-resumes-mid-series-on-reload",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("sync-cross-cutting/spectator-resumes-mid-series-on-reload");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    try {
      await setUpSpectatedGame(host, guest);

      logger.step("Host plays game 1, continues, escalates to Best of 3 (now 1-0, series still live)");
      await simulator.playGameWithScriptedDeals(host.page, TEAM0_WIN_SCRIPT, { logger, contextLabel: "host" });
      await newGame.continueSharedGame(host.page);
      await newGame.acceptRematchEscalation(host.page);
      await guest.page.waitForTimeout(config.syncSettleMs);

      logger.step("Spectator reopens the app mid-series -- it must resume, not clear");
      await reloadAndBoot(guest.page);
      await guest.page.waitForTimeout(config.syncSettleMs);

      const tourneyAfter = (await storage.readKey(guest.page, storage.KEYS.tournament)).value;
      const codeAfter = (await storage.readKey(guest.page, storage.KEYS.syncCode)).raw;
      const champion = tourneyAfter && tourneyAfter.champion;
      if (tourneyAfter === null || codeAfter === null) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary: `Spectator was cleared MID-SERIES (between games of a Best of 3, champion=${champion}) -- an over-eager terminal-state check dropped them out of a live series (tourney ${tourneyAfter === null ? "null" : "present"}, syncCode ${codeAfter === null ? "null" : "present"})`,
          expected: "tourney and syncCode both still present (series in progress)",
          actual: { tourneyCleared: tourneyAfter === null, syncCodeCleared: codeAfter === null },
          page: guest.page,
          contextLabel: "guest",
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
  if (await sync.whoSheet(guest.page).count()) {
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

// The cross-match lost-update race: two devices record results for two
// DIFFERENT matches at (as near as possible) the same instant. Under the old
// whole-object .set() sync, each device's write replaced the entire record
// based on its own local snapshot -- whichever write landed second erased the
// other match's result (last-write-wins). The per-hand lock system never
// covered this, since the two devices aren't touching the same hand. Granular
// per-unit writes (see tourneyUnitDiff in index.html) are the fix; this
// scenario is its regression guard.
const concurrentDifferentMatches = {
  name: "sync-cross-cutting/concurrent-different-matches-no-lost-update",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("sync-cross-cutting/concurrent-different-matches-no-lost-update");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    try {
      // 8 players -> 4 teams -> round 0 has two independent matches.
      const names = Array.from({ length: 8 }, (_, i) => `X${i + 1}`);
      await nav.goto(host.page, "Tournament");
      await tSetup.setupAndStart(host.page, { names, format: "single" });
      if (!(await sync.connectGuest(host, guest, { hostName: names[0], guestName: names[1], logger }))) return;
      await guest.page.waitForTimeout(config.syncSettleMs);

      logger.step("Host opens match 1's options, guest opens match 2's options");
      await host.page.locator(".mbox.ready:visible").nth(0).click({ timeout: config.actionTimeoutMs });
      await guest.page.locator(".mbox.ready:visible").nth(1).click({ timeout: config.actionTimeoutMs });
      await host.page.waitForTimeout(80);
      await guest.page.waitForTimeout(80);
      // The ready-match sheet's h3 is "TeamA  vs  TeamB" -- first team wins each.
      const hostTeam = (await bracket.matchOptionsHeader(host.page)).split(/\s+vs\s+/)[0].trim();
      const guestTeam = (await bracket.matchOptionsHeader(guest.page)).split(/\s+vs\s+/)[0].trim();
      logger.step(`Simultaneous manual wins: host records "${hostTeam}" (match 1), guest records "${guestTeam}" (match 2)`);
      await Promise.all([
        bracket.recordManualWin(host.page, hostTeam),
        bracket.recordManualWin(guest.page, guestTeam),
      ]);

      await host.page.waitForTimeout(config.syncSettleMs);
      await guest.page.waitForTimeout(config.syncSettleMs);
      // Force a render pass on both so the UI reflects the latest snapshot.
      for (const device of [host, guest]) {
        await nav.goto(device.page, "Game");
        await nav.goto(device.page, "Tournament");
      }

      for (const [label, device] of [["host", host], ["guest", guest]]) {
        const t = (await storage.readKey(device.page, storage.KEYS.tournament)).value;
        const r0 = (t && t.rounds && t.rounds[0]) || [];
        const winners = r0.map((m) => (m ? m.winner : null));
        const decided = winners.filter((w) => typeof w === "number").length;
        if (decided < 2) {
          await logger.record({
            severity: "critical",
            category: "sync-divergence",
            summary: `Cross-match lost update: after host and guest recorded wins for two different matches simultaneously, ${label}'s round 0 only shows ${decided}/2 results (winners=${JSON.stringify(winners)})`,
            expected: "both round-0 matches decided on both devices",
            actual: { device: label, winners },
            pages: { host: host.page, guest: guest.page },
          });
        } else {
          // Both results present -- also confirm the winners actually advanced
          // into round 1 (a merge that kept the winner but dropped the cascade
          // would still corrupt the bracket).
          const next = t.rounds[1] && t.rounds[1][0];
          if (!next || next.a == null || next.b == null) {
            await logger.record({
              severity: "critical",
              category: "sync-divergence",
              summary: `Cross-match advancement lost: both round-0 winners recorded, but ${label}'s round 1 slot is missing an advanced team (a=${next && next.a}, b=${next && next.b})`,
              expected: "round 1 match seeded with both winners",
              actual: { device: label, next },
              pages: { host: host.page, guest: guest.page },
            });
          }
        }
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

module.exports = [
  invalidJoinCode,
  concurrentDifferentHands,
  concurrentSameHand,
  concurrentDifferentMatches,
  offlineReconnect,
  spectatorClearsFinishedOnReload,
  spectatorResumesMidSeries,
];

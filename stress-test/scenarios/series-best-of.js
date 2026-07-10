"use strict";
const browserLib = require("../lib/browser");
const nav = require("../lib/pageobjects/nav");
const tSetup = require("../lib/pageobjects/tournamentSetup");
const seriesSetup = require("../lib/pageobjects/seriesSetup");
const bracket = require("../lib/pageobjects/bracket");
const sync = require("../lib/pageobjects/sync");
const newGame = require("../lib/pageobjects/newGame");
const history = require("../lib/pageobjects/history");
const simulator = require("../lib/simulator");
const storage = require("../lib/pageobjects/storage");
const seats = require("../lib/pageobjects/seats");
const config = require("../config");

async function startSeriesLocal(page, bestOf, names) {
  await nav.goto(page, "Tournament");
  await tSetup.openBestOfSeriesSetup(page);
  return seriesSetup.setupAndStartRandom(page, { names, bestOf });
}

function basicCase(bestOf) {
  const name = `series-best-of/local-bestof${bestOf}`;
  return {
    name,
    phase: "local",
    run: async ({ browser, store }) => {
      const logger = store.newScenario(name);
      const device = await browserLib.createDevice(browser, { label: "solo", scenarioLogger: logger });
      try {
        const names = [`A${bestOf}`, `B${bestOf}`, `C${bestOf}`, `D${bestOf}`];
        const teams = await startSeriesLocal(device.page, bestOf, names);
        logger.step(`Series teams: ${teams.join(" | ")}`);

        const played = await simulator.playTournamentToChampion(device.page, {
          logger,
          contextLabel: "solo",
          maxMatches: bestOf,
          dismissOffer: false,
        });
        logger.step(`Games played: ${played}`);

        const sub = await bracket.seriesSubText(device.page);
        const champSide = await bracket.seriesChampSide(device.page);
        if (!sub || !sub.includes("Series over") || champSide == null) {
          await logger.record({
            severity: "critical",
            category: "ui-stuck",
            summary: `Best-of-${bestOf} series did not reach a decided state (sub="${sub}", champSide=${champSide})`,
            page: device.page,
          });
        }
        const minGamesToClinch = Math.floor(bestOf / 2) + 1;
        if (played < minGamesToClinch) {
          await logger.record({
            severity: "high",
            category: "scoring-correctness",
            summary: `Series clinched after only ${played} games, expected at least ${minGamesToClinch} for best-of-${bestOf}`,
            expected: `>= ${minGamesToClinch}`,
            actual: played,
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
}

function syncCase(bestOf) {
  const name = `series-best-of/sync-bestof${bestOf}`;
  return {
    name,
    phase: "sync",
    run: async ({ browser, store }) => {
      const logger = store.newScenario(name);
      const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
      const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
      try {
        const names = [`SA${bestOf}`, `SB${bestOf}`, `SC${bestOf}`, `SD${bestOf}`];
        await startSeriesLocal(host.page, bestOf, names);
        await sync.shareFromBracket(host.page);
        const code = await sync.readJoinCode(host.page);
        await sync.identifyFromShareSheet(host.page, names[0]);

        await nav.goto(guest.page, "Tournament");
        await tSetup.openJoinSheet(guest.page);
        await sync.joinWithCode(guest.page, code);
        if (await guest.page.locator('[role="dialog"][aria-label="Identify yourself"]').count()) {
          await sync.chooseIdentity(guest.page, names[1]);
        }

        const played = await simulator.playTournamentToChampion(host.page, {
          logger,
          contextLabel: "host",
          maxMatches: bestOf,
          dismissOffer: false, // declining a linked offer locally clears tourney -- see simulator.js note
        });
        logger.step(`Games played by host: ${played}`);

        await guest.page.waitForTimeout(config.syncSettleMs);
        await nav.goto(guest.page, "Game");
        await nav.goto(guest.page, "Tournament");
        const hostSub = await bracket.seriesSubText(host.page);
        const guestSub = await bracket.seriesSubText(guest.page);
        const hostChamp = await bracket.seriesChampSide(host.page);
        const guestChamp = await bracket.seriesChampSide(guest.page);
        if (hostChamp == null || hostChamp !== guestChamp) {
          await logger.record({
            severity: "critical",
            category: "sync-divergence",
            summary: `Host and guest disagree on the series outcome (host sub="${hostSub}" champ=${hostChamp}, guest sub="${guestSub}" champ=${guestChamp})`,
            expected: hostChamp,
            actual: guestChamp,
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
}

// A deterministic 5-deal script where seat 0's team always wins 10-0 each
// hand, reaching exactly 50 -- used by the regression scenarios below where
// *which* team wins doesn't matter, but reliably clinching on a known game
// number does.
const TEAM0_WIN_SCRIPT = Array.from({ length: 5 }, () => ({ bidder: { seat: 0 }, bid: 10, pointsTaken: 10 }));

async function playOneScriptedMatch(page, logger, contextLabel) {
  await bracket.openNextMatch(page);
  await bracket.playInApp(page);
  await simulator.playGameWithScriptedDeals(page, TEAM0_WIN_SCRIPT, { logger, contextLabel });
  await bracket.returnToBracket(page);
}

// --- Regression 1: local series tally persists across a page reload mid-series ---
const persistAcrossReload = {
  name: "series-best-of/regression-tally-persists-across-reload",
  phase: "local",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("series-best-of/regression-tally-persists-across-reload");
    const device = await browserLib.createDevice(browser, { label: "solo", scenarioLogger: logger });
    try {
      await startSeriesLocal(device.page, 3, ["RA", "RB", "RC", "RD"]);
      await playOneScriptedMatch(device.page, logger, "solo");
      const before = await bracket.seriesWinsCount(device.page);
      logger.step(`Series wins before reload: ${before}`);

      await device.page.reload({ waitUntil: "domcontentloaded" });
      await device.page.locator("nav#nav button.nav-btn").first().waitFor({ state: "visible" });
      await nav.goto(device.page, "Tournament");
      const after = await bracket.seriesWinsCount(device.page);
      logger.step(`Series wins after reload: ${after}`);

      if (before[0] !== after[0] || before[1] !== after[1]) {
        await logger.record({
          severity: "critical",
          category: "correctness",
          summary: `Series tally changed across a page reload (before=[${before}], after=[${after}])`,
          expected: before,
          actual: after,
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

// --- Regression 2 & 3: bracket-flow escalation offer appears, and undoing the
// clinching game rolls the escalation back ---
const escalationAndUndoRollback = {
  name: "series-best-of/regression-escalation-undo-rollback",
  phase: "local",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("series-best-of/regression-escalation-undo-rollback");
    const device = await browserLib.createDevice(browser, { label: "solo", scenarioLogger: logger });
    try {
      await startSeriesLocal(device.page, 3, ["EA", "EB", "EC", "ED"]);
      logger.step("Playing game 1 (team0 wins)");
      await playOneScriptedMatch(device.page, logger, "solo");
      logger.step("Playing game 2 (team0 wins again -> clinches Best of 3, 2-0)");
      await playOneScriptedMatch(device.page, logger, "solo");

      const offerVisible = await newGame.playAgainOfferVisible(device.page);
      if (!offerVisible) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary:
            'Clinching a series via the Tournament-tab bracket flow ("Play in app" + "Return to Bracket") did not trigger the series-escalation offer -- regresses "Offer series escalation from the bracket flow, not just the Game tab"',
          expected: "an escalation offer dialog visible",
          actual: "no dialog",
          page: device.page,
        });
        return;
      }

      logger.step("Accepting the escalation (Best of 3 -> Best of 5)");
      await newGame.acceptRematchEscalation(device.page);
      const subAfterEscalate = await bracket.seriesSubText(device.page);
      logger.step(`Series sub-label after accepting escalation: "${subAfterEscalate}"`);
      if (!subAfterEscalate || !subAfterEscalate.includes("5")) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: `Accepting the Best-of-5 escalation offer didn't seem to update the series length (sub="${subAfterEscalate}")`,
          expected: "sub-label mentioning Best of 5",
          actual: subAfterEscalate,
          page: device.page,
        });
      }

      logger.step("Undoing game 2 (the clinching game) via 'Clear result'");
      await bracket.openSeriesGameRow(device.page, 2);
      await bracket.clearSeriesGameResult(device.page);

      const subAfterUndo = await bracket.seriesSubText(device.page);
      const winsAfterUndo = await bracket.seriesWinsCount(device.page);
      logger.step(`After undo: sub="${subAfterUndo}", wins=${winsAfterUndo}`);
      if (!subAfterUndo || subAfterUndo.includes("5") || !subAfterUndo.includes("3")) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary: `Undoing the clinching game did not roll the escalation back to Best of 3 (sub="${subAfterUndo}") -- regresses "Roll back a best-of-N escalation when its clinching game is undone"`,
          expected: "sub-label mentioning Best of 3, not 5",
          actual: subAfterUndo,
          page: device.page,
        });
      }
      if (winsAfterUndo[0] !== 1 || winsAfterUndo[1] !== 0) {
        await logger.record({
          severity: "high",
          category: "scoring-correctness",
          summary: `After undoing the clinching game, expected the series score to revert to [1,0], got [${winsAfterUndo}]`,
          expected: [1, 0],
          actual: winsAfterUndo,
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

// --- Regression 4 & 5: on a shared (Game-tab) series, the clinching game's
// button label isn't stale, and a teammate's auto-synced History entry
// carries the championship badge ---
const sharedClinchLabelAndBadge = {
  name: "series-best-of/regression-shared-clinch-label-and-badge",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("series-best-of/regression-shared-clinch-label-and-badge");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    try {
      await seats.nameAllSeats(host.page, ["G1", "G2", "G3", "G4"]);
      await sync.shareFromGameOptions(host.page);
      const code = await sync.readJoinCode(host.page);
      await sync.identifyFromShareSheet(host.page, "G1");

      await nav.goto(guest.page, "Tournament");
      await tSetup.openJoinSheet(guest.page);
      await sync.joinWithCode(guest.page, code);
      await guest.page.waitForTimeout(300);
      if (await guest.page.locator('[role="dialog"][aria-label="Identify yourself"]').count()) {
        await sync.chooseIdentity(guest.page, "G3"); // G1's teammate: seats 0 & 2
      }

      logger.step("Host plays game 1 (bestOf=1) and continues");
      await simulator.playGameWithScriptedDeals(host.page, TEAM0_WIN_SCRIPT, { logger, contextLabel: "host" });
      await newGame.continueSharedGame(host.page);
      const offerVisible = await newGame.playAgainOfferVisible(host.page);
      if (!offerVisible) {
        await logger.record({
          severity: "high",
          category: "ui-stuck",
          summary: "Expected a series-escalation offer after continuing a clinched bestOf=1 shared game",
          page: host.page,
          contextLabel: "host",
        });
        return;
      }
      logger.step("Host accepts escalation to Best of 3");
      await newGame.acceptRematchEscalation(host.page);

      logger.step("Host plays game 2 (clinching, 2-0) but does NOT continue yet");
      await simulator.playGameWithScriptedDeals(host.page, TEAM0_WIN_SCRIPT, { logger, contextLabel: "host" });

      await guest.page.waitForTimeout(config.syncSettleMs);
      const guestBtnTexts = await guest.page.locator(".add-wrap .btn.btn-new:visible").allTextContents();
      logger.step(`Guest's pad button(s) while clinched-but-not-continued: ${JSON.stringify(guestBtnTexts)}`);
      const staleLabel = guestBtnTexts.find((t) => /^Play Game \d+$/.test(t.trim()));
      if (staleLabel) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary: `Guest sees a stale "${staleLabel}" button on an already-clinched shared series (2-0 in a Best of 3) instead of a "Continue"-style affordance -- regresses 'Fix misleading "Play Game N" label on a clinched shared series'`,
          expected: "no Play Game N button once the series is already decided",
          actual: guestBtnTexts,
          page: guest.page,
          contextLabel: "guest",
        });
      }

      logger.step("Host taps Continue to finalize the champion, declines further escalation");
      await newGame.continueSharedGame(host.page);
      await newGame.dismissPlayAgainOffer(host.page);

      await guest.page.waitForTimeout(config.syncSettleMs);
      await nav.goto(guest.page, "History");
      const guestHist = await storage.readKey(guest.page, "somerset:dev-history");
      const entries = (guestHist.value || []).filter((g) => g.tournament && g.tournament.id);
      const champEntry = entries.find((g) => g.tournament && g.tournament.championship === true);
      if (!champEntry) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary:
            "Teammate's (guest's) auto-synced History for the winning side of a clinched shared series has no entry flagged tournament.championship=true -- regresses \"Fix teammates' auto-synced History missing the championship badge\"",
          expected: "at least one guest History entry with tournament.championship === true",
          actual: JSON.stringify(entries.map((e) => e.tournament)),
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

module.exports = [
  basicCase(3),
  basicCase(5),
  basicCase(7),
  syncCase(3),
  syncCase(5),
  syncCase(7),
  persistAcrossReload,
  escalationAndUndoRollback,
  sharedClinchLabelAndBadge,
];

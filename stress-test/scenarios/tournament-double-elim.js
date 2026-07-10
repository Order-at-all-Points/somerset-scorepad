"use strict";
const browserLib = require("../lib/browser");
const nav = require("../lib/pageobjects/nav");
const tSetup = require("../lib/pageobjects/tournamentSetup");
const bracket = require("../lib/pageobjects/bracket");
const sync = require("../lib/pageobjects/sync");
const simulator = require("../lib/simulator");
const storage = require("../lib/pageobjects/storage");
const config = require("../config");

function localCase(playerCount, { regression = false } = {}) {
  const name = regression
    ? `tournament-double-elim/regression-losers-bracket-${playerCount / 2}-teams`
    : `tournament-double-elim/local-${playerCount}p`;
  return {
    name,
    phase: "local",
    run: async ({ browser, store }) => {
      const logger = store.newScenario(name);
      const device = await browserLib.createDevice(browser, { label: "solo", scenarioLogger: logger });
      try {
        const names = Array.from({ length: playerCount }, (_, i) => `D${i + 1}`);
        await nav.goto(device.page, "Tournament");
        const teams = await tSetup.setupAndStart(device.page, { names, format: "double" });
        logger.step(`Drawn ${teams.length} teams for double elimination (regression=${regression})`);

        const played = await simulator.playTournamentToChampion(device.page, {
          logger,
          contextLabel: "solo",
          maxMatches: 20,
        });
        logger.step(`Matches played: ${played}`);
        const champion = await bracket.championText(device.page);
        if (!champion) {
          await logger.record({
            severity: "critical",
            category: regression ? "regression-repro" : "ui-stuck",
            summary: `Double elimination with ${teams.length} teams did not reach a champion screen (matches played: ${played})`,
            expected: "a Champions: banner",
            page: device.page,
          });
        }
      } catch (e) {
        await logger.record({
          severity: "high",
          category: regression ? "regression-repro" : "scenario-crash",
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

function syncCase(playerCount) {
  const name = `tournament-double-elim/sync-${playerCount}p`;
  return {
    name,
    phase: "sync",
    run: async ({ browser, store }) => {
      const logger = store.newScenario(name);
      const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
      const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
      try {
        const names = Array.from({ length: playerCount }, (_, i) => `DS${i + 1}`);
        await nav.goto(host.page, "Tournament");
        await tSetup.setupAndStart(host.page, { names, format: "double" });

        await sync.shareFromBracket(host.page);
        const code = await sync.readJoinCode(host.page);
        await sync.identifyFromShareSheet(host.page, names[0]);

        await nav.goto(guest.page, "Tournament");
        await tSetup.openJoinSheet(guest.page);
        await sync.joinWithCode(guest.page, code);
        const joinErr = await sync.joinErrorText(guest.page);
        if (joinErr) {
          await logger.record({
            severity: "critical",
            category: "sync-divergence",
            summary: `Guest failed to join with a fresh code: ${joinErr}`,
            page: guest.page,
            contextLabel: "guest",
          });
          return;
        }
        if (await guest.page.locator('[role="dialog"][aria-label="Identify yourself"]').count()) {
          await sync.chooseIdentity(guest.page, names[1]);
        }

        const played = await simulator.playTournamentToChampion(host.page, {
          logger,
          contextLabel: "host",
          maxMatches: 20,
        });
        logger.step(`Matches played by host: ${played}`);

        await guest.page.waitForTimeout(config.syncSettleMs);
        const hostChamp = await bracket.championText(host.page);
        await nav.goto(guest.page, "Game");
        await nav.goto(guest.page, "Tournament");
        const guestChamp = await bracket.championText(guest.page);
        if (!hostChamp || hostChamp !== guestChamp) {
          const hostT = await storage.readKey(host.page, "somerset:dev-tournament");
          const guestT = await storage.readKey(guest.page, "somerset:dev-tournament");
          await logger.record({
            severity: "critical",
            category: "sync-divergence",
            summary: `Host and guest disagree on the double-elim champion after sync settle (host="${hostChamp}", guest="${guestChamp}")`,
            expected: hostChamp,
            actual: guestChamp,
            pages: { host: host.page, guest: guest.page },
            extra: { hostChampion: hostT.value && hostT.value.champion, guestChampion: guestT.value && guestT.value.champion },
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

module.exports = [
  localCase(6), // 3 teams
  localCase(8), // 4 teams
  syncCase(6),
  syncCase(8),
  // README explicitly calls out the 5- and 6-team losers-bracket cases as
  // historically the trickiest to get right in double elimination.
  localCase(10, { regression: true }), // 5 teams
  localCase(12, { regression: true }), // 6 teams
];

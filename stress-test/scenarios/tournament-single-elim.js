"use strict";
const browserLib = require("../lib/browser");
const nav = require("../lib/pageobjects/nav");
const tSetup = require("../lib/pageobjects/tournamentSetup");
const bracket = require("../lib/pageobjects/bracket");
const sync = require("../lib/pageobjects/sync");
const simulator = require("../lib/simulator");
const storage = require("../lib/pageobjects/storage");
const config = require("../config");

function localCase(playerCount, expectBye) {
  const name = `tournament-single-elim/local-${playerCount}p`;
  return {
    name,
    phase: "local",
    run: async ({ browser, store }) => {
      const logger = store.newScenario(name);
      const device = await browserLib.createDevice(browser, { label: "solo", scenarioLogger: logger });
      try {
        const names = Array.from({ length: playerCount }, (_, i) => `P${i + 1}`);
        await nav.goto(device.page, "Tournament");
        const validity = await tSetup.countValidityText(device.page);
        logger.step(`Default count validity text: "${validity}"`);
        const teams = await tSetup.setupAndStart(device.page, { names, format: "single" });
        logger.step(`Drawn teams: ${teams.join(" | ")}`);

        const html = await device.page.locator(".bracket-wrap").innerHTML();
        const hasBye = html.includes("bye");
        if (hasBye !== expectBye) {
          await logger.record({
            severity: "medium",
            category: "correctness",
            summary: `Expected bye=${expectBye} for ${playerCount} players (${teams.length} teams), bracket bye marker present=${hasBye}`,
            expected: expectBye,
            actual: hasBye,
            page: device.page,
          });
        }

        const played = await simulator.playTournamentToChampion(device.page, { logger, contextLabel: "solo" });
        logger.step(`Matches played: ${played}`);
        const champion = await bracket.championText(device.page);
        if (!champion) {
          await logger.record({
            severity: "critical",
            category: "ui-stuck",
            summary: "Single-elim tournament did not reach a champion screen",
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

function syncCase(playerCount) {
  const name = `tournament-single-elim/sync-${playerCount}p`;
  return {
    name,
    phase: "sync",
    run: async ({ browser, store }) => {
      const logger = store.newScenario(name);
      const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
      const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
      try {
        const names = Array.from({ length: playerCount }, (_, i) => `S${i + 1}`);
        await nav.goto(host.page, "Tournament");
        await tSetup.setupAndStart(host.page, { names, format: "single" });

        // This scenario only cares about bracket/champion sync, so host and
        // guest just identify as the first two roster names.
        if (!(await sync.connectGuest(host, guest, { hostName: names[0], guestName: names[1], logger }))) return;

        const played = await simulator.playTournamentToChampion(host.page, { logger, contextLabel: "host" });
        logger.step(`Matches played by host: ${played}`);

        await guest.page.waitForTimeout(config.syncSettleMs);
        await guest.page.bringToFront();
        const hostChamp = await bracket.championText(host.page);
        // Guest needs a render to reflect the latest snapshot -- nav away and back forces one.
        await nav.goto(guest.page, "Game");
        await nav.goto(guest.page, "Tournament");
        const guestChamp = await bracket.championText(guest.page);
        if (!hostChamp || hostChamp !== guestChamp) {
          const hostT = await storage.readKey(host.page, storage.KEYS.tournament);
          const guestT = await storage.readKey(guest.page, storage.KEYS.tournament);
          await logger.record({
            severity: "critical",
            category: "sync-divergence",
            summary: `Host and guest disagree on the tournament champion after sync settle (host="${hostChamp}", guest="${guestChamp}")`,
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
  localCase(6, true), // 3 teams -- odd, one bye
  localCase(8, false), // 4 teams -- even, no bye
  syncCase(6),
  syncCase(8),
];

"use strict";
const fs = require("fs");
const path = require("path");
const browserLib = require("../lib/browser");
const nav = require("../lib/pageobjects/nav");
const history = require("../lib/pageobjects/history");
const storage = require("../lib/pageobjects/storage");
const simulator = require("../lib/simulator");
const newGame = require("../lib/pageobjects/newGame");
const config = require("../config");

const NAME = "history-export-import/round-trip-and-dedup";

const roundTripAndDedup = {
  name: NAME,
  phase: "local",
  run: async ({ browser, store }) => {
    const logger = store.newScenario(NAME);
    const device = await browserLib.createDevice(browser, { label: "solo", scenarioLogger: logger });
    const backupPath = path.join(config.artifactsDir, "history-export-import-backup.json");
    try {
      logger.step("Play 2 full games to populate History");
      for (let i = 0; i < 2; i++) {
        await simulator.playDealsToCompletion(device.page, {
          bidderFor: simulator.teamIndexBidderFor,
          seed: 3001 + i,
          logger,
          contextLabel: "solo",
        });
        await newGame.dismissPlayAgainOffer(device.page);
        await newGame.clickNewGameDirect(device.page).catch(() => {});
      }

      await nav.goto(device.page, "History");
      const idsBefore = await history.entryIds(device.page);
      logger.step(`History entries before export: ${idsBefore.length}`);
      if (idsBefore.length !== 2) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: `Expected 2 History entries after playing 2 games, found ${idsBefore.length}`,
          expected: 2,
          actual: idsBefore.length,
          page: device.page,
        });
      }

      logger.step("Export a backup");
      const exp = await history.exportHistory(device.page);
      fs.writeFileSync(backupPath, exp.raw);
      if (!exp.parsed || !Array.isArray(exp.parsed.games) || exp.parsed.games.length !== idsBefore.length) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: `Exported backup doesn't contain the expected game count (expected ${idsBefore.length}, got ${exp.parsed && exp.parsed.games && exp.parsed.games.length})`,
          expected: idsBefore.length,
          actual: exp.parsed && exp.parsed.games && exp.parsed.games.length,
          page: device.page,
        });
      }

      logger.step("Clear local storage (simulating a reinstall) and import the backup");
      await storage.clearAll(device.page);
      await device.page.reload({ waitUntil: "domcontentloaded" });
      await device.page.locator("nav#nav button.nav-btn").first().waitFor({ state: "visible" });
      await nav.goto(device.page, "History");
      const idsAfterClear = await history.entryIds(device.page);
      if (idsAfterClear.length !== 0) {
        await logger.record({
          severity: "medium",
          category: "correctness",
          summary: `History wasn't actually empty after clearing localStorage (found ${idsAfterClear.length} entries) -- import round-trip check below may be unreliable`,
          page: device.page,
        });
      }

      const importMsg = await history.importHistoryFile(device.page, backupPath);
      logger.step(`Import message: "${importMsg}"`);
      await history.dismissInfoModal(device.page);
      const idsAfterImport = await history.entryIds(device.page);
      if (idsAfterImport.length !== idsBefore.length) {
        await logger.record({
          severity: "critical",
          category: "correctness",
          summary: `Import round-trip lost data: expected ${idsBefore.length} entries back, got ${idsAfterImport.length}`,
          expected: idsBefore.length,
          actual: idsAfterImport.length,
          page: device.page,
        });
      }
      const idsBeforeSet = new Set(idsBefore);
      const idsMismatch = idsAfterImport.some((id) => !idsBeforeSet.has(id));
      if (idsMismatch) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: "Imported entries have different ids than the originally-exported ones",
          expected: idsBefore,
          actual: idsAfterImport,
          page: device.page,
        });
      }

      logger.step("Re-import the same file -- should dedupe, not double the entries");
      const importMsg2 = await history.importHistoryFile(device.page, backupPath);
      logger.step(`Re-import message: "${importMsg2}"`);
      await history.dismissInfoModal(device.page);
      const idsAfterReimport = await history.entryIds(device.page);
      if (idsAfterReimport.length !== idsBefore.length) {
        await logger.record({
          severity: "critical",
          category: "correctness",
          summary: `Re-importing the same backup file created duplicates: expected still ${idsBefore.length} entries, got ${idsAfterReimport.length}`,
          expected: idsBefore.length,
          actual: idsAfterReimport.length,
          page: device.page,
        });
      }
      if (!importMsg2 || !/no new games/i.test(importMsg2)) {
        await logger.record({
          severity: "low",
          category: "correctness",
          summary: `Re-import message didn't read as a dedup notice: "${importMsg2}"`,
          expected: 'a "No new games to restore" style message',
          actual: importMsg2,
          page: device.page,
        });
      }

      logger.step("Import a garbage file -- should show a friendly error, not crash");
      const garbagePath = path.join(config.artifactsDir, "history-export-import-garbage.json");
      fs.writeFileSync(garbagePath, "{ not: valid json");
      const garbageMsg = await history.importHistoryFile(device.page, garbagePath);
      if (!garbageMsg || !/doesn't look like/i.test(garbageMsg)) {
        await logger.record({
          severity: "medium",
          category: "correctness",
          summary: `Importing a malformed file didn't show the expected friendly error (got "${garbageMsg}")`,
          expected: "a friendly parse-error message",
          actual: garbageMsg,
          page: device.page,
        });
      }
      await history.dismissInfoModal(device.page);
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

module.exports = [roundTripAndDedup];

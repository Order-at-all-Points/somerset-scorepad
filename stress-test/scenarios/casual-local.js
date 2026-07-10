"use strict";
const browserLib = require("../lib/browser");
const simulator = require("../lib/simulator");
const handEntry = require("../lib/pageobjects/handEntry");
const newGame = require("../lib/pageobjects/newGame");
const dealHistory = require("../lib/pageobjects/dealHistory");
const oracle = require("../lib/oracle");

async function withDevice(browser, store, name, fn) {
  const logger = store.newScenario(name);
  const device = await browserLib.createDevice(browser, { label: "solo", scenarioLogger: logger });
  try {
    await fn(device.page, logger);
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
}

const fullGameToFifty = {
  name: "casual-local/full-game-to-50",
  phase: "local",
  run: async ({ browser, store }) =>
    withDevice(browser, store, "casual-local/full-game-to-50", async (page, logger) => {
      await simulator.playDealsToCompletion(page, {
        bidderFor: simulator.teamIndexBidderFor,
        seed: 1001,
        logger,
        contextLabel: "solo",
      });
      await newGame.dismissPlayAgainOffer(page);
    }),
};

const moonAtNonNegativeScore = {
  name: "casual-local/moon-instant-win-at-nonneg-score",
  phase: "local",
  run: async ({ browser, store }) =>
    withDevice(browser, store, "casual-local/moon-instant-win-at-nonneg-score", async (page, logger) => {
      const res = await simulator.playGameWithScriptedDeals(
        page,
        [
          { bidder: { teamIndex: 0 }, bid: 8, pointsTaken: 8 }, // team0 at 8, still >=0
          { bidder: { teamIndex: 0 }, bid: 14, pointsTaken: 14 }, // moon from a non-negative score -> instant win to 50
        ],
        { logger, contextLabel: "solo" }
      );
      if (!res.detail.moonWin || res.detail.winner !== 0) {
        await logger.record({
          severity: "critical",
          category: "scoring-correctness",
          summary: "Oracle did not register the expected moon instant-win",
          expected: "moonWin=true, winner=0",
          actual: JSON.stringify(res.detail),
          page,
        });
      }
      const totals = await newGame.readTeamTotals(page);
      if (totals[0] !== 50) {
        await logger.record({
          severity: "critical",
          category: "scoring-correctness",
          summary: `Moon at non-negative score should jump straight to 50, app shows ${totals[0]}`,
          expected: 50,
          actual: totals[0],
          page,
        });
      }
      await newGame.dismissPlayAgainOffer(page);
    }),
};

const moonAttemptWhileNegative = {
  name: "casual-local/moon-attempt-while-negative-no-autowin",
  phase: "local",
  run: async ({ browser, store }) =>
    withDevice(browser, store, "casual-local/moon-attempt-while-negative-no-autowin", async (page, logger) => {
      const res = await simulator.playGameWithScriptedDeals(
        page,
        [
          { bidder: { teamIndex: 0 }, bid: 12, pointsTaken: 2 }, // set: 0 - 12 = -12
          { bidder: { teamIndex: 0 }, bid: 14, pointsTaken: 14 }, // moon attempt while negative -> ordinary +14, no win
        ],
        { logger, contextLabel: "solo" }
      );
      if (res.detail.winner != null) {
        await logger.record({
          severity: "critical",
          category: "scoring-correctness",
          summary: "A moon attempted from a negative score should NOT auto-win, but a winner was recorded",
          expected: "winner=null",
          actual: JSON.stringify(res.detail),
          page,
        });
      }
      const totals = await newGame.readTeamTotals(page);
      const expectedTeam0 = -12 + 14; // ordinary points, not a jump to 50
      if (totals[0] !== expectedTeam0) {
        await logger.record({
          severity: "critical",
          category: "scoring-correctness",
          summary: `Moon-while-negative should score as ordinary points (expected ${expectedTeam0}), app shows ${totals[0]}`,
          expected: expectedTeam0,
          actual: totals[0],
          page,
        });
      }
    }),
};

const setGoesNegative = {
  name: "casual-local/set-penalty-goes-negative",
  phase: "local",
  run: async ({ browser, store }) =>
    withDevice(browser, store, "casual-local/set-penalty-goes-negative", async (page, logger) => {
      await simulator.playGameWithScriptedDeals(
        page,
        [{ bidder: { teamIndex: 1 }, bid: 11, pointsTaken: 3 }],
        { logger, contextLabel: "solo" }
      );
      const warnings = await handEntry.resultWarnings(page).catch(() => []);
      const totals = await newGame.readTeamTotals(page);
      if (totals[1] !== -11) {
        await logger.record({
          severity: "critical",
          category: "scoring-correctness",
          summary: `Set team should be at -bid (-11), app shows ${totals[1]}`,
          expected: -11,
          actual: totals[1],
          page,
        });
      }
    }),
};

const editPastDealRecomputes = {
  name: "casual-local/edit-past-deal-recomputes-totals",
  phase: "local",
  run: async ({ browser, store }) =>
    withDevice(browser, store, "casual-local/edit-past-deal-recomputes-totals", async (page, logger) => {
      await simulator.playGameWithScriptedDeals(
        page,
        [
          { bidder: { teamIndex: 0 }, bid: 8, pointsTaken: 8 },
          { bidder: { teamIndex: 1 }, bid: 10, pointsTaken: 4 }, // set, will edit this one to "made" instead
          { bidder: { teamIndex: 0 }, bid: 6, pointsTaken: 9 },
        ],
        { logger, contextLabel: "solo" }
      );
      logger.step("Editing deal 2 from a set (10/4) to made (10/10)");
      await dealHistory.editDeal(page, 2);
      await handEntry.goToStep2(page);
      await handEntry.setPointsTaken(page, 10);
      await handEntry.submitDeal(page);

      const expected = oracle.finalTotals([
        { bidTeam: 0, bid: 8, pointsTaken: 8 },
        { bidTeam: 1, bid: 10, pointsTaken: 10 },
        { bidTeam: 0, bid: 6, pointsTaken: 9 },
      ]);
      const actual = await newGame.readTeamTotals(page);
      if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
        await logger.record({
          severity: "critical",
          category: "scoring-correctness",
          summary: "Editing a past deal did not recompute downstream totals correctly",
          expected,
          actual,
          page,
        });
      }
    }),
};

const deleteAndUndo = {
  name: "casual-local/delete-deal-undo-window",
  phase: "local",
  run: async ({ browser, store }) =>
    withDevice(browser, store, "casual-local/delete-deal-undo-window", async (page, logger) => {
      await simulator.playGameWithScriptedDeals(
        page,
        [
          { bidder: { teamIndex: 0 }, bid: 8, pointsTaken: 8 },
          { bidder: { teamIndex: 1 }, bid: 7, pointsTaken: 7 },
        ],
        { logger, contextLabel: "solo" }
      );
      const beforeDelete = await newGame.readTeamTotals(page);

      logger.step("Deleting deal 2, undoing within the 5s window");
      await dealHistory.deleteDeal(page, 2);
      if (!(await dealHistory.undoToastVisible(page))) {
        await logger.record({
          severity: "medium",
          category: "ui-stuck",
          summary: "Undo toast did not appear immediately after deleting a deal",
          page,
        });
      }
      await dealHistory.clickUndo(page);
      const afterUndo = await newGame.readTeamTotals(page);
      if (afterUndo[0] !== beforeDelete[0] || afterUndo[1] !== beforeDelete[1]) {
        await logger.record({
          severity: "high",
          category: "scoring-correctness",
          summary: "Undoing a deal deletion did not restore the prior totals",
          expected: beforeDelete,
          actual: afterUndo,
          page,
        });
      }

      logger.step("Deleting deal 2 again, letting the undo window expire cleanly (no re-trigger)");
      // Wait past UNDO_LEAVE_MS (250ms) so this delete doesn't itself land inside
      // the previous toast's fade-out window -- see undoToastRaceLeak below for
      // that race deliberately triggered.
      await page.waitForTimeout(400);
      await dealHistory.deleteDeal(page, 2);
      // UNDO_TOAST_MS (5000) + UNDO_LEAVE_MS (250) + slack for the fade-out
      // animation and IPC overhead -- 5500 was measured to be right on the
      // boundary and flaked.
      await page.waitForTimeout(6000);
      if (await page.locator(".undo-toast").count()) {
        await logger.record({
          severity: "low",
          category: "ui-stuck",
          summary: "Undo toast still visible after its 5s window should have expired",
          page,
        });
      }
      const dealCount = await dealHistory.dealCount(page);
      if (dealCount !== 1) {
        await logger.record({
          severity: "high",
          category: "scoring-correctness",
          summary: `Expected 1 deal to remain after the expired-undo deletion, found ${dealCount}`,
          expected: 1,
          actual: dealCount,
          page,
        });
      }
    }),
};

const undoToastRaceLeak = {
  name: "casual-local/undo-toast-orphaned-on-rapid-redelete",
  phase: "local",
  run: async ({ browser, store }) =>
    withDevice(browser, store, "casual-local/undo-toast-orphaned-on-rapid-redelete", async (page, logger) => {
      // Root cause (read directly from index.html's dismissUndoToast/showUndoToast,
      // ~line 3325): clicking "Undo" calls the non-instant dismissUndoToast(), which
      // nulls the shared `undoToastEl` reference and schedules the old toast's DOM
      // removal via `undoLeaveTimer` (UNDO_LEAVE_MS = 250ms later) while it plays a
      // fade-out animation. If a NEW toast is shown (showUndoToast -> dismissUndoToast(true))
      // before that 250ms elapses, the instant-dismiss path only checks the (already-null)
      // `undoToastEl` and bails out -- it cancels the pending removal timer but never
      // actually removes the fading-out node, since it has no reference to it. That
      // first toast is left permanently orphaned in the DOM (class "...leaving" forever,
      // role="status") -- a real, if minor, DOM/accessibility leak triggered by deleting
      // a second item within ~250ms of clicking Undo on a previous delete.
      await simulator.playGameWithScriptedDeals(
        page,
        [
          { bidder: { teamIndex: 0 }, bid: 8, pointsTaken: 8 },
          { bidder: { teamIndex: 1 }, bid: 7, pointsTaken: 7 },
          { bidder: { teamIndex: 0 }, bid: 6, pointsTaken: 6 },
        ],
        { logger, contextLabel: "solo" }
      );

      logger.step("Delete deal 3, click Undo, then immediately delete deal 2 (within ~250ms)");
      await dealHistory.deleteDeal(page, 3);
      await dealHistory.clickUndo(page);
      await dealHistory.deleteDeal(page, 2); // fires right after Undo, well inside UNDO_LEAVE_MS

      await page.waitForTimeout(6200); // long enough for both toasts' full lifecycle to resolve either way
      const remaining = await page.locator(".undo-toast").count();
      if (remaining > 0) {
        await logger.record({
          severity: "medium",
          category: "ui-stuck",
          summary:
            "Deleting a second item within ~250ms of clicking Undo on a prior delete leaves an orphaned .undo-toast permanently stuck in the DOM (dismissUndoToast(true) cancels the pending removal timer for the fading-out toast but never removes it, since undoToastEl was already nulled by the manual Undo click)",
          expected: "0 .undo-toast elements remain once both toasts' lifecycles resolve",
          actual: `${remaining} .undo-toast element(s) still present`,
          page,
        });
      }
    }),
};

const newGameConfirmFlow = {
  name: "casual-local/new-game-confirm-cancel-and-yes",
  phase: "local",
  run: async ({ browser, store }) =>
    withDevice(browser, store, "casual-local/new-game-confirm-cancel-and-yes", async (page, logger) => {
      await simulator.playGameWithScriptedDeals(page, [{ bidder: { teamIndex: 0 }, bid: 8, pointsTaken: 8 }], {
        logger,
        contextLabel: "solo",
      });

      logger.step("Options -> New Game -> Keep playing (should not reset)");
      await newGame.newGameViaOptions(page, { confirm: false });
      const dealCountAfterCancel = await dealHistory.dealCount(page);
      if (dealCountAfterCancel !== 1) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: "Declining the New Game confirmation still reset the game",
          expected: 1,
          actual: dealCountAfterCancel,
          page,
        });
      }

      logger.step("Options -> New Game -> Yes, start fresh (should reset)");
      await newGame.newGameViaOptions(page, { confirm: true });
      const dealCountAfterConfirm = await dealHistory.dealCount(page);
      if (dealCountAfterConfirm !== 0) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: "Confirming New Game did not clear the deal list",
          expected: 0,
          actual: dealCountAfterConfirm,
          page,
        });
      }
    }),
};

module.exports = [
  fullGameToFifty,
  moonAtNonNegativeScore,
  moonAttemptWhileNegative,
  setGoesNegative,
  editPastDealRecomputes,
  deleteAndUndo,
  undoToastRaceLeak,
  newGameConfirmFlow,
];

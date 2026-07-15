"use strict";
const browserLib = require("../lib/browser");
const seats = require("../lib/pageobjects/seats");
const sync = require("../lib/pageobjects/sync");
const history = require("../lib/pageobjects/history");
const nav = require("../lib/pageobjects/nav");
const newGame = require("../lib/pageobjects/newGame");
const storage = require("../lib/pageobjects/storage");
const simulator = require("../lib/simulator");
const tSetup = require("../lib/pageobjects/tournamentSetup");
const config = require("../config");

const NAME = "casual-shared/share-game-host-guest-identity-autoarchive";

const shareGameHostGuest = {
  name: NAME,
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario(NAME);
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    try {
      logger.step("Host: name all 4 seats");
      await seats.nameAllSeats(host.page, ["H1", "H2", "H3", "H4"]);

      logger.step("Host: share this game");
      await sync.shareFromGameOptions(host.page);
      const code = await sync.readJoinCode(host.page);
      if (!code || code.length !== 6) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Share produced an unexpected join code: "${code}"`,
          page: host.page,
          contextLabel: "host",
        });
      }
      await sync.identifyFromShareSheet(host.page, "H1");

      logger.step(`Guest: join with code ${code}`);
      await nav.goto(guest.page, "Tournament");
      await tSetup.openJoinSheet(guest.page);
      await sync.joinWithCode(guest.page, code);
      const joinErr = await sync.joinErrorText(guest.page);
      if (joinErr) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Guest failed to join with a fresh valid code: ${joinErr}`,
          page: guest.page,
          contextLabel: "guest",
        });
        return;
      }
      await guest.page.waitForTimeout(300);
      // Guest is prompted to identify -- pick H3, host's teammate (seats 0/2).
      const whoVisible = (await guest.page.locator('[role="dialog"][aria-label="Identify yourself"]').count()) > 0;
      if (whoVisible) await sync.chooseIdentity(guest.page, "H3");

      logger.step("Compare tourney state across devices after settle delay");
      await host.page.waitForTimeout(config.syncSettleMs);
      const hostT = await storage.readKey(host.page, storage.KEYS.tournament);
      const guestT = await storage.readKey(guest.page, storage.KEYS.tournament);
      const hostCode = hostT.value && hostT.value._code;
      const guestCode = guestT.value && guestT.value._code;
      if (!hostCode || hostCode !== guestCode) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: "Host and guest tourney snapshots disagree on the shared _code after joining",
          expected: hostCode,
          actual: guestCode,
          pages: { host: host.page, guest: guest.page },
        });
      }

      logger.step("Host plays the game to completion");
      await simulator.playDealsToCompletion(host.page, {
        bidderFor: simulator.namedBidderFor,
        seed: 2002,
        logger,
        contextLabel: "host",
      });
      // Shared games skip the "Play again?" offer entirely and instead show a
      // "Continue" button that must be tapped to finalize the win -- see
      // newGame.continueSharedGame's doc comment.
      const continued = await newGame.continueSharedGame(host.page);
      if (!continued) {
        await logger.record({
          severity: "high",
          category: "ui-stuck",
          summary: "Expected a Continue button on the host's pad after winning a shared game, found none",
          page: host.page,
          contextLabel: "host",
        });
      }
      // For a bestOf=1 shared game, tapping Continue is what triggers the
      // series-escalation "Play again?" offer (advanceSharedGame sets
      // ui.offerSeries once priorBestOf===1) -- decline it to keep this
      // scenario a plain 1-off game.
      await newGame.dismissPlayAgainOffer(host.page);

      logger.step("Wait for sync, then check both devices' own History for exactly one auto-archived entry");
      await guest.page.waitForTimeout(config.syncSettleMs);
      await nav.goto(host.page, "History");
      await nav.goto(guest.page, "History");
      await guest.page.waitForTimeout(300);
      const hostEntries = await history.entryIds(host.page);
      const guestEntries = await history.entryIds(guest.page);
      if (hostEntries.length !== 1) {
        // Root cause (confirmed by inspecting somerset:dev-history directly): a
        // host who is ALSO self-identified as a roster player in a shared
        // bestOf=1 game gets archived twice, via two independent dedup
        // mechanisms that don't know about each other. recordDeal() archives
        // immediately when the winning deal is recorded, guarded only by
        // `game.archivedId` (index.html ~3437: `game.archivedId =
        // archiveCurrentGame(...)`). Separately, once the host taps Continue,
        // advanceSharedGame() nulls `.game`; the host's own Firebase
        // subscription then re-delivers that snapshot to
        // syncMyHistoryFromTourney() (~1190), which sees `.game == null`,
        // finds the host's own name in the roster, and archives it AGAIN --
        // guarded only by the separate `archivedMatches[uid]` map, which has
        // no idea `game.archivedId` already covered this game. The two
        // resulting records differ only in incidental metadata (one carries
        // `championship:true`, the other `tieBreak:false`) but have identical
        // deals/totals/winner. This directly contradicts the app's own
        // documented guarantee (README, "Self-identify as a player": "...with
        // no duplicate entries if you also played/recorded it yourself").
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Self-identified host's own History gets a duplicate entry for a shared bestOf=1 game they played themselves (found ${hostEntries.length}, expected 1) -- contradicts the README's "no duplicate entries" guarantee`,
          expected: 1,
          actual: hostEntries.length,
          page: host.page,
          contextLabel: "host",
        });
      }
      if (guestEntries.length !== 1) {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Guest's own History (auto-synced, not self-recorded) should have exactly 1 entry, found ${guestEntries.length} -- checks the "teammate's games land in your own History, deduped" feature`,
          expected: 1,
          actual: guestEntries.length,
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

module.exports = [shareGameHostGuest];

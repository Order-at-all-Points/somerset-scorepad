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

// A shared best-of-1 game must log on BOTH devices the instant it's won, even
// if nobody taps "Continue". This is the trickier archiving path: recordDeal
// only stamps m.winner for bestOf>1, so a bestOf=1 game leaves m.winner null
// until the (never-tapped) Continue, and the other device must derive the
// winner from the live game itself (gameWinner(m.game)). It also guards against
// the recording device double-logging its own game once it's decided.
const bestOf1LogsWithoutContinue = {
  name: "casual-shared/bestof1-logs-without-continue",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("casual-shared/bestof1-logs-without-continue");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    try {
      await seats.nameAllSeats(host.page, ["N1", "N2", "N3", "N4"]);
      await sync.shareFromGameOptions(host.page);
      const code = await sync.readJoinCode(host.page);
      await sync.identifyFromShareSheet(host.page, "N1");

      await nav.goto(guest.page, "Tournament");
      await tSetup.openJoinSheet(guest.page);
      await sync.joinWithCode(guest.page, code);
      await guest.page.waitForTimeout(300);
      if (await sync.whoSheet(guest.page).count()) {
        await sync.chooseIdentity(guest.page, "N3"); // N1's teammate (seats 0 & 2)
      }

      logger.step("Host plays the shared game to completion but NOBODY taps Continue");
      await simulator.playDealsToCompletion(host.page, {
        bidderFor: simulator.namedBidderFor,
        seed: 3131,
        logger,
        contextLabel: "host",
      });
      // Deliberately NOT tapping Continue.

      logger.step("Wait for sync, then check both devices logged exactly one game");
      await guest.page.waitForTimeout(config.syncSettleMs);
      const hostHist = ((await storage.readKey(host.page, storage.KEYS.history)).value || [])
        .filter((g) => g.winner != null);
      const guestHist = ((await storage.readKey(guest.page, storage.KEYS.history)).value || [])
        .filter((g) => g.winner != null);
      if (guestHist.length !== 1) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary: `Guest never logged a completed shared best-of-1 game because nobody tapped Continue (found ${guestHist.length}, expected 1) -- regresses "log completed matches without a Continue tap" for the bestOf=1 gameWinner-derivation path`,
          expected: 1,
          actual: guestHist.length,
          page: guest.page,
          contextLabel: "guest",
        });
      } else if (guestHist[0].deals && guestHist[0].deals.length === 0) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary: "Guest's early-logged shared game has an empty deals array -- buildHistoryRecordForMatch fell through to the manual branch instead of reading the live .game",
          expected: "non-empty deals",
          actual: "deals.length === 0",
          page: guest.page,
          contextLabel: "guest",
        });
      }
      if (hostHist.length !== 1) {
        await logger.record({
          severity: "high",
          category: "regression-repro",
          summary: `Recording host logged its own shared game ${hostHist.length} times (expected 1) -- the recordDeal auto-archive and the decided-game sync path both fired without deduping`,
          expected: 1,
          actual: hostHist.length,
          page: host.page,
          contextLabel: "host",
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

// A lone shared game is wrapped internally as format:"series" bestOf:1 to reuse
// the sync/lock machinery, but to the player it's just one game -- so its History
// record must read and count as a *Standard* game, never a "Tournament Match".
// Guards isTournamentRecord (a series is only a tournament when bestOf > 1).
const loneSharedGameIsStandard = {
  name: "casual-shared/lone-shared-game-is-standard",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("casual-shared/lone-shared-game-is-standard");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    try {
      await seats.nameAllSeats(host.page, ["S1", "S2", "S3", "S4"]);
      await sync.shareFromGameOptions(host.page); // wraps the solo game as format:"series" bestOf:1
      await sync.identifyFromShareSheet(host.page, "S1");

      logger.step("Play the shared game to completion, continue, decline the series offer");
      await simulator.playDealsToCompletion(host.page, {
        bidderFor: simulator.namedBidderFor,
        seed: 4242,
        logger,
        contextLabel: "host",
      });
      await newGame.continueSharedGame(host.page);
      await newGame.dismissPlayAgainOffer(host.page); // keep it a lone 1-off, no escalation

      await host.page.waitForTimeout(config.syncSettleMs);
      const recs = ((await storage.readKey(host.page, storage.KEYS.history)).value || []).filter((g) => g.winner != null);
      if (recs.length !== 1) {
        await logger.record({
          severity: "high",
          category: "regression-repro",
          summary: `Expected exactly one logged shared game, found ${recs.length}`,
          expected: 1,
          actual: recs.length,
          page: host.page,
          contextLabel: "host",
        });
        return;
      }
      const rec = recs[0];
      // Internal representation is deliberately unchanged -- it's still a wrapped
      // bestOf:1 series; only its *classification* should read as Standard.
      if (!(rec.tournament && rec.tournament.format === "series" && rec.tournament.bestOf === 1)) {
        await logger.record({
          severity: "high",
          category: "test-precondition",
          summary: `Shared lone game wasn't stored as the expected format:"series" bestOf:1 wrapper (got ${JSON.stringify(rec.tournament)})`,
          actual: JSON.stringify(rec.tournament),
          page: host.page,
          contextLabel: "host",
        });
        return;
      }

      logger.step("History must classify it as Standard, not a Tournament Match");
      await nav.goto(host.page, "History");
      await host.page.waitForTimeout(200);
      const cat = await history.entryCat(host.page, rec.id);
      const meta = await history.entryMeta(host.page, rec.id);
      if (cat !== "standard") {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary: `A lone shared bestOf:1 game renders as a tournament entry (data-cat="${cat}", expected "standard") -- regresses "treat a single game as Standard, not a Best-of-1 tournament"`,
          expected: "standard",
          actual: cat,
          page: host.page,
          contextLabel: "host",
        });
      }
      if (!/Standard Game/.test(meta) || /Tournament/.test(meta)) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary: `A lone shared game's History meta line reads as a tournament ("${meta}"), expected "Standard Game"`,
          expected: "…· Standard Game: N Hands",
          actual: meta,
          page: host.page,
          contextLabel: "host",
        });
      }

      logger.step("Filter pills: 'Tournament' excludes it, 'Standard' includes it");
      await history.setFilter(host.page, "Tournament");
      if ((await history.entryIds(host.page)).includes(rec.id)) {
        await logger.record({
          severity: "high",
          category: "regression-repro",
          summary: "The 'Tournament' History filter still shows a lone shared game",
          page: host.page,
          contextLabel: "host",
        });
      }
      await history.setFilter(host.page, "Standard");
      if (!(await history.entryIds(host.page)).includes(rec.id)) {
        await logger.record({
          severity: "high",
          category: "regression-repro",
          summary: "The 'Standard' History filter hides a lone shared game that should be Standard",
          page: host.page,
          contextLabel: "host",
        });
      }
    } catch (e) {
      await logger.record({
        severity: "high",
        category: "scenario-crash",
        summary: `Scenario threw: ${e.message}`,
        actual: e.stack,
        page: host.page,
      });
    } finally {
      await browserLib.closeDevice(host);
    }
  },
};

module.exports = [shareGameHostGuest, bestOf1LogsWithoutContinue, loneSharedGameIsStandard];

"use strict";
const browserLib = require("../lib/browser");
const seats = require("../lib/pageobjects/seats");
const sync = require("../lib/pageobjects/sync");
const history = require("../lib/pageobjects/history");
const nav = require("../lib/pageobjects/nav");
const newGame = require("../lib/pageobjects/newGame");
const storage = require("../lib/pageobjects/storage");
const stats = require("../lib/pageobjects/stats");
const simulator = require("../lib/simulator");
const tSetup = require("../lib/pageobjects/tournamentSetup");
const handEntry = require("../lib/pageobjects/handEntry");
const dealHistory = require("../lib/pageobjects/dealHistory");
const bracket = require("../lib/pageobjects/bracket");
const emulator = require("../lib/emulator");
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

      // Regression: a lone shared game always clinches its own wrapper "series"
      // the instant it's decided (bestOf:1 -> the only game IS the last game),
      // so isClinchingMatch/the Continue-tap handler used to stamp
      // tournament.championship:true unconditionally on tourney.champion being
      // set -- independent of isTournamentRecord(). That gave the winners a
      // trophy despite History correctly labeling the game "Standard Game".
      // Guards tourneyHasRealChampionship (a series only has a real title once
      // bestOf > 1).
      logger.step("The record must never be stamped championship:true -- a lone game has no real title to hand out");
      if (rec.tournament.championship) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary: `A lone shared bestOf:1 game's own record was stamped tournament.championship:true (${JSON.stringify(rec.tournament)}), which shows a trophy for its winners despite reading as a Standard game`,
          expected: "championship: falsy",
          actual: JSON.stringify(rec.tournament),
          page: host.page,
          contextLabel: "host",
        });
      }

      logger.step("The winning player's Stats must not credit a championship for this lone game");
      const winnerName = rec.players[rec.winner];
      await stats.openStatsBoard(host.page);
      await stats.openPlayerDetail(host.page, winnerName);
      await host.page.waitForTimeout(150);
      const tiles = host.page.locator(".stats-tile-grid .stats-tile");
      const tileCount = await tiles.count();
      let championshipsTile = null;
      for (let i = 0; i < tileCount; i++) {
        const label = (await tiles.nth(i).innerText()).trim();
        if (/Championships/i.test(label)) {
          championshipsTile = Number((await tiles.nth(i).locator(".stats-tile-num").textContent()).trim());
          break;
        }
      }
      if (championshipsTile) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary: `${winnerName}'s Championships stat tile reads ${championshipsTile} after winning only a lone shared bestOf:1 game, expected 0`,
          expected: 0,
          actual: championshipsTile,
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

// A shared match auto-archives on every participant's device the instant it's
// decided -- but the deal that decided it can still be corrected afterward on
// whichever device is scoring, and that correction can flip the winner. A
// device that had already archived must adopt the correction; otherwise its
// copy of that matchUid disagrees with everyone else's forever, and the two
// devices show different career W/L for the same games.
//
// This is a repro of a real production divergence (2026-07-21): a deciding deal
// was entered as bid 7 / took 6 (a set -> the OTHER team crossed 50 and won),
// two devices auto-archived within 0.3s, the deal was then corrected to bid 6 /
// took 14 (made -> the bidding team crossed 50 instead), and only the devices
// that hadn't archived yet ever saw the fix. Guards reconcileArchivedRecord.
const decidingDealCorrectionPropagates = {
  name: "casual-shared/deciding-deal-correction-propagates",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("casual-shared/deciding-deal-correction-propagates");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    // Seats 0/2 are one team, 1/3 the other. Host is C1 (seat 0, team 0) and
    // guest is C2 (seat 1, team 1) so the correction flips the guest from a
    // win to a loss -- the divergence has to be visible in the guest's own
    // record, not just in the shared deal list.
    const readRec = async (page) =>
      ((await storage.readKey(page, storage.KEYS.history)).value || []).filter((g) => g.winner != null);
    try {
      await seats.nameAllSeats(host.page, ["C1", "C2", "C3", "C4"]);
      await sync.shareFromGameOptions(host.page);
      const code = await sync.readJoinCode(host.page);
      await sync.identifyFromShareSheet(host.page, "C1");

      await nav.goto(guest.page, "Tournament");
      await tSetup.openJoinSheet(guest.page);
      await sync.joinWithCode(guest.page, code);
      await guest.page.waitForTimeout(300);
      if (await sync.whoSheet(guest.page).count()) await sync.chooseIdentity(guest.page, "C2");

      // Walks team 0 to 39 and team 1 to 45 (target 50, nothing decided yet),
      // then the 7th deal decides it. Mirrors the production game exactly.
      logger.step("Host plays 6 deals to 39-45, then a 7th that sets team 0 and hands team 1 the win");
      const leadUp = [
        { bidder: { seat: 1 }, bid: 7, pointsTaken: 9 },
        { bidder: { seat: 1 }, bid: 7, pointsTaken: 13 },
        { bidder: { seat: 0 }, bid: 7, pointsTaken: 7 },
        { bidder: { seat: 1 }, bid: 6, pointsTaken: 11 },
        { bidder: { seat: 0 }, bid: 7, pointsTaken: 9 },
        { bidder: { seat: 2 }, bid: 7, pointsTaken: 14 },
      ];
      for (const d of leadUp) await handEntry.playDeal(host.page, d);
      const preTotals = await newGame.readTeamTotals(host.page);
      if (preTotals[0] !== 39 || preTotals[1] !== 45) {
        await logger.record({
          severity: "high",
          category: "test-precondition",
          summary: `Lead-up deals didn't reach the intended 39-45 (got [${preTotals}]) -- the rest of this scenario's assertions assume it`,
          expected: [39, 45],
          actual: preTotals,
          page: host.page,
          contextLabel: "host",
        });
        return;
      }
      // bid 7, took 6 -> set -> team 0 drops to 32, team 1 takes the other 8 to 53.
      await handEntry.playDeal(host.page, { bidder: { seat: 0 }, bid: 7, pointsTaken: 6 });

      logger.step("Both devices auto-archive the decided match");
      await guest.page.waitForTimeout(config.syncSettleMs);
      const guestBefore = await readRec(guest.page);
      if (guestBefore.length !== 1 || guestBefore[0].winner !== 1) {
        await logger.record({
          severity: "high",
          category: "test-precondition",
          summary: `Guest should have auto-archived exactly one record won by team 1 before the correction (got ${guestBefore.length} record(s), winner=${guestBefore[0] && guestBefore[0].winner})`,
          expected: "1 record, winner 1",
          actual: `${guestBefore.length} record(s), winner ${guestBefore[0] && guestBefore[0].winner}`,
          page: guest.page,
          contextLabel: "guest",
        });
        return;
      }

      // The cloud copy has to exist BEFORE the correction, or the later
      // "was it re-pushed?" assertion is vacuous -- syncHistoryToCloud only
      // skips ids it has already pushed, so a record that was never pushed
      // would get written afterward regardless of the reconcile.
      const guestUidEarly = (await storage.readKey(guest.page, storage.KEYS.authUid)).raw;
      const cloudBefore = guestUidEarly
        ? await emulator.pollFor(async () => {
            const v = await emulator.dbGet(`users/${guestUidEarly}/history/${guestBefore[0].id}`);
            return v && v.winner === 1 ? v : null;
          })
        : null;
      if (!cloudBefore) {
        await logger.record({
          severity: "high",
          category: "test-precondition",
          summary: "Guest's auto-archived record never reached the cloud before the correction, so this scenario can't tell a re-push apart from a first push",
          page: guest.page,
          contextLabel: "guest",
        });
        return;
      }

      logger.step("Host corrects the deciding deal to bid 6 / took 14, flipping the winner to team 0");
      await dealHistory.editDeal(host.page, 7);
      await handEntry.setBid(host.page, 6);
      await handEntry.goToStep2(host.page);
      await handEntry.setPointsTaken(host.page, 14);
      await handEntry.submitDeal(host.page);
      const postTotals = await newGame.readTeamTotals(host.page);
      if (postTotals[0] !== 53 || postTotals[1] !== 45) {
        await logger.record({
          severity: "high",
          category: "test-precondition",
          summary: `Correcting the deciding deal didn't produce the intended 53-45 (got [${postTotals}])`,
          expected: [53, 45],
          actual: postTotals,
          page: host.page,
          contextLabel: "host",
        });
        return;
      }

      logger.step("Guest's already-archived record must converge on the correction");
      await guest.page.waitForTimeout(config.syncSettleMs);
      const guestAfter = await readRec(guest.page);
      const hostAfter = await readRec(host.page);
      if (guestAfter.length !== 1) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Reconciling a corrected deal changed the guest's record count to ${guestAfter.length} (expected 1) -- a correction must update the archived record in place, never add a second copy`,
          expected: 1,
          actual: guestAfter.length,
          page: guest.page,
          contextLabel: "guest",
        });
        return;
      }
      const g = guestAfter[0];
      if (g.winner !== 0) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Guest's archived record still shows winner ${g.winner} after the host corrected the deciding deal (expected 0) -- the device keeps its pre-correction copy forever, so the two devices report different career W/L for the same game`,
          expected: 0,
          actual: g.winner,
          page: guest.page,
          contextLabel: "guest",
        });
      }
      if (JSON.stringify(g.totals) !== JSON.stringify([53, 45])) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Guest's archived record kept its pre-correction totals [${g.totals}] (expected [53,45])`,
          expected: [53, 45],
          actual: g.totals,
          page: guest.page,
          contextLabel: "guest",
        });
      }
      if (hostAfter.length === 1 && JSON.stringify(g.deals) !== JSON.stringify(hostAfter[0].deals)) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: "Host and guest archived copies of the same matchUid hold different deals after a post-archive correction",
          expected: JSON.stringify(hostAfter[0].deals),
          actual: JSON.stringify(g.deals),
          pages: { host: host.page, guest: guest.page },
        });
      }
      // The record is updated in place: it keeps the identity it was archived
      // with (its own id, and that device's own archive time), so anything
      // holding a reference to it -- highlights, the cloud copy's key -- stays
      // valid instead of being orphaned by a delete-and-re-add.
      if (g.id !== guestBefore[0].id || g.date !== guestBefore[0].date) {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Reconciling replaced the guest's record identity instead of updating it in place (id ${guestBefore[0].id} -> ${g.id}, date ${guestBefore[0].date} -> ${g.date})`,
          expected: `id ${guestBefore[0].id}, date ${guestBefore[0].date}`,
          actual: `id ${g.id}, date ${g.date}`,
          page: guest.page,
          contextLabel: "guest",
        });
      }

      // syncHistoryToCloud() only pushes ids it hasn't pushed before, so a
      // corrected record needs its id explicitly forgotten or the cloud keeps
      // the stale copy -- which is what any LINKED device of the same person
      // reads (linkedHistoryCache), so they'd go on showing the old result.
      logger.step("The cloud copy of the corrected record must be re-pushed, not left stale");
      const guestUid = (await storage.readKey(guest.page, storage.KEYS.authUid)).raw;
      if (guestUid) {
        // pollFor keeps going until its fn returns something truthy, so only
        // hand back the record once it has actually converged; on give-up,
        // re-read it plainly so the finding can report what's really stored.
        const converged = await emulator.pollFor(async () => {
          const v = await emulator.dbGet(`users/${guestUid}/history/${g.id}`);
          return v && v.winner === 0 ? v : null;
        });
        const cloud = converged || (await emulator.dbGet(`users/${guestUid}/history/${g.id}`));
        if (!cloud) {
          await logger.record({
            severity: "high",
            category: "sync-divergence",
            summary: `Guest's corrected record (${g.id}) is missing from the cloud entirely`,
            page: guest.page,
            contextLabel: "guest",
          });
        } else if (cloud.winner !== 0 || JSON.stringify(cloud.totals) !== JSON.stringify([53, 45])) {
          await logger.record({
            severity: "high",
            category: "sync-divergence",
            summary: `Guest's cloud history copy kept the pre-correction result (winner ${cloud.winner}, totals [${cloud.totals}]) even though the local record was reconciled -- a linked device would keep reading the stale game`,
            expected: "winner 0, totals [53,45]",
            actual: `winner ${cloud.winner}, totals [${cloud.totals}]`,
            page: guest.page,
            contextLabel: "guest",
          });
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

// The repair path for a device that was already offline when the correction
// happened: it has to converge when the player later REJOINS the old code, with
// no extra taps. Same divergence as decidingDealCorrectionPropagates, but the
// guest misses the correction entirely, reloads (fresh JS state, localStorage
// intact), and rejoins by code -- and its saved per-session identity points at a
// DIFFERENT code by then (they've played elsewhere since), so convergence has to
// come from autoIdentifyFromDeviceName matching the persistent device name
// against the roster, not from a retained identity decision.
const decidingDealCorrectionRepairsOnRejoin = {
  name: "casual-shared/deciding-deal-correction-repairs-on-rejoin",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("casual-shared/deciding-deal-correction-repairs-on-rejoin");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    const readRec = async (page) =>
      ((await storage.readKey(page, storage.KEYS.history)).value || []).filter((g) => g.winner != null);
    try {
      await seats.nameAllSeats(host.page, ["R1", "R2", "R3", "R4"]);
      await sync.shareFromGameOptions(host.page);
      const code = await sync.readJoinCode(host.page);
      await sync.identifyFromShareSheet(host.page, "R1");

      await nav.goto(guest.page, "Tournament");
      await tSetup.openJoinSheet(guest.page);
      await sync.joinWithCode(guest.page, code);
      await guest.page.waitForTimeout(300);
      if (await sync.whoSheet(guest.page).count()) await sync.chooseIdentity(guest.page, "R2");

      const leadUp = [
        { bidder: { seat: 1 }, bid: 7, pointsTaken: 9 },
        { bidder: { seat: 1 }, bid: 7, pointsTaken: 13 },
        { bidder: { seat: 0 }, bid: 7, pointsTaken: 7 },
        { bidder: { seat: 1 }, bid: 6, pointsTaken: 11 },
        { bidder: { seat: 0 }, bid: 7, pointsTaken: 9 },
        { bidder: { seat: 2 }, bid: 7, pointsTaken: 14 },
      ];
      for (const d of leadUp) await handEntry.playDeal(host.page, d);
      await handEntry.playDeal(host.page, { bidder: { seat: 0 }, bid: 7, pointsTaken: 6 });

      logger.step("Guest auto-archives the (wrong) result, then goes away");
      await guest.page.waitForTimeout(config.syncSettleMs);
      const guestBefore = await readRec(guest.page);
      if (guestBefore.length !== 1 || guestBefore[0].winner !== 1) {
        await logger.record({
          severity: "high",
          category: "test-precondition",
          summary: `Guest should have auto-archived one record won by team 1 before going offline (got ${guestBefore.length} record(s), winner=${guestBefore[0] && guestBefore[0].winner})`,
          page: guest.page,
          contextLabel: "guest",
        });
        return;
      }
      await guest.context.setOffline(true);

      logger.step("Host corrects the deciding deal while the guest is away");
      await dealHistory.editDeal(host.page, 7);
      await handEntry.setBid(host.page, 6);
      await handEntry.goToStep2(host.page);
      await handEntry.setPointsTaken(host.page, 14);
      await handEntry.submitDeal(host.page);
      await host.page.waitForTimeout(config.syncSettleMs);

      // Stand in for "has played other shared games since, and isn't in this
      // session any more": drop the persisted sync code so the reload boots
      // unsynced and the rejoin is a real join (otherwise the app just resumes
      // this same session on reload and never shows the join sheet), and bind
      // the saved per-session identity to some other code so rejoining is an
      // undecided session again. The device-wide name (R2) survives, which is
      // what autoIdentifyFromDeviceName has to match against the roster.
      await guest.page.evaluate(() => {
        window.localStorage.setItem("somerset:dev-my-name", JSON.stringify({ code: "ZZZZZZ", name: "R2" }));
        window.localStorage.removeItem("somerset:dev-sync-code");
        window.localStorage.removeItem("somerset:dev-sync-role");
      });

      logger.step("Guest comes back, reloads, clears the stale local session, and rejoins the old code");
      await guest.context.setOffline(false);
      await guest.page.reload({ waitUntil: "domcontentloaded" });
      await guest.page.locator("nav#nav button.nav-btn").first().waitFor({ state: "visible" });
      await nav.goto(guest.page, "Tournament");
      // The Tournament tab has no "Join with code" affordance while a
      // tournament is already loaded, so rejoining an older code means leaving
      // the current one first. Worth asserting as part of the repair path: it's
      // a step the player has to take, not something the app does for them.
      await bracket.endTournament(guest.page);
      await guest.page.waitForTimeout(200);
      await tSetup.openJoinSheet(guest.page);
      await sync.joinWithCode(guest.page, code);
      await guest.page.waitForTimeout(config.syncSettleMs);

      if (await sync.whoSheet(guest.page).count()) {
        await logger.record({
          severity: "medium",
          category: "ui-stuck",
          summary: "Rejoining prompted the identify sheet even though the device name still matches a roster seat -- the repair would need an extra tap",
          page: guest.page,
          contextLabel: "guest",
        });
        await sync.chooseIdentity(guest.page, "R2");
        await guest.page.waitForTimeout(config.syncSettleMs);
      }

      const guestAfter = await readRec(guest.page);
      if (guestAfter.length !== 1) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Rejoining left the guest with ${guestAfter.length} records (expected 1) -- the repair must fix the existing record, not add another`,
          expected: 1,
          actual: guestAfter.length,
          page: guest.page,
          contextLabel: "guest",
        });
        return;
      }
      const g = guestAfter[0];
      if (g.winner !== 0 || JSON.stringify(g.totals) !== JSON.stringify([53, 45])) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Rejoining the old code didn't repair the stale record (winner ${g.winner}, totals [${g.totals}]) -- a player who was away when the deal was corrected can never fix their own history`,
          expected: "winner 0, totals [53,45]",
          actual: `winner ${g.winner}, totals [${g.totals}]`,
          page: guest.page,
          contextLabel: "guest",
        });
      }
      if (g.id !== guestBefore[0].id) {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Rejoining replaced the record's identity (${guestBefore[0].id} -> ${g.id}) instead of repairing it in place`,
          page: guest.page,
          contextLabel: "guest",
        });
      }

      logger.step("The cloud copy must be repaired too, not just the local one");
      const guestUid = (await storage.readKey(guest.page, storage.KEYS.authUid)).raw;
      if (guestUid) {
        const converged = await emulator.pollFor(async () => {
          const v = await emulator.dbGet(`users/${guestUid}/history/${g.id}`);
          return v && v.winner === 0 ? v : null;
        });
        const cloud = converged || (await emulator.dbGet(`users/${guestUid}/history/${g.id}`));
        if (!cloud || cloud.winner !== 0) {
          await logger.record({
            severity: "high",
            category: "sync-divergence",
            summary: `Guest's cloud history copy still holds the pre-correction result after the rejoin repair (${cloud ? "winner " + cloud.winner : "missing"}) -- their linked devices and their published stats digest stay wrong`,
            expected: "winner 0",
            actual: cloud ? `winner ${cloud.winner}` : "missing",
            page: guest.page,
            contextLabel: "guest",
          });
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

// The other way a participant's History ends up out of step: they were simply
// away while a game was played, so they never archived it at all. Rejoining the
// old code has to back-fill it -- this is the pre-existing catch-up path in
// syncMyHistoryFromTourney (an unarchived decided match), not the reconcile, and
// it must keep working alongside it. Also pins down what the back-filled record
// is dated: catch-up stamps the archive time, NOT when the game was played.
const missedGamesBackfillOnRejoin = {
  name: "casual-shared/missed-games-backfill-on-rejoin",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("casual-shared/missed-games-backfill-on-rejoin");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    const readRec = async (page) =>
      ((await storage.readKey(page, storage.KEYS.history)).value || []).filter((g) => g.winner != null);
    try {
      await seats.nameAllSeats(host.page, ["B1", "B2", "B3", "B4"]);
      await sync.shareFromGameOptions(host.page);
      const code = await sync.readJoinCode(host.page);
      await sync.identifyFromShareSheet(host.page, "B1");

      await nav.goto(guest.page, "Tournament");
      await tSetup.openJoinSheet(guest.page);
      await sync.joinWithCode(guest.page, code);
      await guest.page.waitForTimeout(300);
      if (await sync.whoSheet(guest.page).count()) await sync.chooseIdentity(guest.page, "B2");
      await guest.page.waitForTimeout(config.syncSettleMs);

      logger.step("Guest goes away BEFORE the game is played, and misses it entirely");
      await guest.context.setOffline(true);
      const guestBefore = await readRec(guest.page);
      if (guestBefore.length !== 0) {
        await logger.record({
          severity: "high",
          category: "test-precondition",
          summary: `Guest should have no archived records before going away (found ${guestBefore.length})`,
          page: guest.page,
          contextLabel: "guest",
        });
        return;
      }

      await simulator.playDealsToCompletion(host.page, {
        bidderFor: simulator.namedBidderFor,
        seed: 8181,
        logger,
        contextLabel: "host",
      });
      await host.page.waitForTimeout(config.syncSettleMs);
      const hostRecs = await readRec(host.page);
      if (!hostRecs.length) {
        await logger.record({
          severity: "high",
          category: "test-precondition",
          summary: "Host never archived the completed game, so there is nothing for the guest to back-fill",
          page: host.page,
          contextLabel: "host",
        });
        return;
      }
      const played = hostRecs[0];

      // Same "played elsewhere since" setup as the rejoin-repair scenario: boot
      // unsynced with the per-session identity bound to another code, so the
      // back-fill has to come from autoIdentifyFromDeviceName.
      await guest.page.evaluate(() => {
        window.localStorage.setItem("somerset:dev-my-name", JSON.stringify({ code: "ZZZZZZ", name: "B2" }));
        window.localStorage.removeItem("somerset:dev-sync-code");
        window.localStorage.removeItem("somerset:dev-sync-role");
      });

      logger.step("Guest returns, clears the stale local session, rejoins -- the missed game must back-fill");
      const rejoinedAt = Date.now();
      await guest.context.setOffline(false);
      await guest.page.reload({ waitUntil: "domcontentloaded" });
      await guest.page.locator("nav#nav button.nav-btn").first().waitFor({ state: "visible" });
      await nav.goto(guest.page, "Tournament");
      if ((await guest.page.locator(".btn.btn-cancel:visible", { hasText: /End Tournament|Leave Tournament|End Game|Leave Game/ }).count()) > 0) {
        await bracket.endTournament(guest.page);
        await guest.page.waitForTimeout(200);
      }
      await tSetup.openJoinSheet(guest.page);
      await sync.joinWithCode(guest.page, code);
      await guest.page.waitForTimeout(config.syncSettleMs);
      if (await sync.whoSheet(guest.page).count()) {
        await logger.record({
          severity: "medium",
          category: "ui-stuck",
          summary: "Rejoining prompted the identify sheet even though the device name still matches a roster seat -- the back-fill would need an extra tap",
          page: guest.page,
          contextLabel: "guest",
        });
        await sync.chooseIdentity(guest.page, "B2");
        await guest.page.waitForTimeout(config.syncSettleMs);
      }

      const guestAfter = await readRec(guest.page);
      if (guestAfter.length !== 1) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Rejoining didn't back-fill the game the guest missed while away (found ${guestAfter.length} record(s), expected 1)`,
          expected: 1,
          actual: guestAfter.length,
          page: guest.page,
          contextLabel: "guest",
        });
        return;
      }
      const g = guestAfter[0];
      // Compare deals field-by-field rather than by JSON string: a record that
      // came back through Firebase has its object keys in sorted order, so
      // stringify would flag a pure key-order difference as a divergence.
      const dealsDiffer = (a, b) => {
        if (!a || !b || a.length !== b.length) return `deal count ${a && a.length} vs ${b && b.length}`;
        for (let i = 0; i < a.length; i++) {
          for (const k of ["bid", "bidTeam", "bidderSeat", "dealer", "id"]) {
            if (a[i][k] !== b[i][k]) return `deal ${i} ${k}: ${a[i][k]} vs ${b[i][k]}`;
          }
          if (JSON.stringify(a[i].pts) !== JSON.stringify(b[i].pts)) {
            return `deal ${i} pts: [${a[i].pts}] vs [${b[i].pts}]`;
          }
        }
        return null;
      };
      const dealDiff = dealsDiffer(g.deals, played.deals);
      if (g.matchUid !== played.matchUid || g.winner !== played.winner || dealDiff) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Back-filled record doesn't match the host's copy of the same match (${dealDiff || "matchUid/winner"})`,
          expected: `matchUid ${played.matchUid}, winner ${played.winner}, ${played.deals.length} deals`,
          actual: `matchUid ${g.matchUid}, winner ${g.winner}, ${g.deals.length} deals`,
          pages: { host: host.page, guest: guest.page },
        });
      }
      // Documents a real, accepted consequence rather than a bug: a back-filled
      // record carries the time it was ARCHIVED, so a game caught up days later
      // shows up in History dated the day of the catch-up, not the day it was
      // played. Fails only if that ever silently changes.
      if (new Date(g.date).getTime() < rejoinedAt) {
        await logger.record({
          severity: "medium",
          category: "sync-divergence",
          summary: `Back-filled record is dated ${g.date}, before the rejoin -- catch-up archiving is expected to stamp the archive time, so this scenario's documented behaviour has changed`,
          expected: `>= ${new Date(rejoinedAt).toISOString()}`,
          actual: g.date,
          page: guest.page,
          contextLabel: "guest",
        });
      }

      logger.step("The back-filled record must reach the cloud too");
      const guestUid = (await storage.readKey(guest.page, storage.KEYS.authUid)).raw;
      if (guestUid) {
        const cloud = await emulator.pollFor(async () => {
          const v = await emulator.dbGet(`users/${guestUid}/history/${g.id}`);
          return v && v.winner != null ? v : null;
        });
        if (!cloud) {
          await logger.record({
            severity: "high",
            category: "sync-divergence",
            summary: `Back-filled record (${g.id}) never reached the guest's cloud history`,
            page: guest.page,
            contextLabel: "guest",
          });
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

// The rules give a session two clocks: writable for 48h, readable for 30d (see
// FIREBASE_SETUP.md). Past the write window every score write is rejected but
// the session still loads, so the client has to SAY it's archived. Before
// sessionFrozen() existed the pad went on offering "Record Bid", the hand-lock
// transaction was denied, and the app blamed a teammate who wasn't there:
// "Someone else just started entering this hand."
const frozenSessionIsReadOnly = {
  name: "casual-shared/frozen-session-reads-as-archived",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("casual-shared/frozen-session-reads-as-archived");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    try {
      await seats.nameAllSeats(host.page, ["F1", "F2", "F3", "F4"]);
      await sync.shareFromGameOptions(host.page);
      const code = await sync.readJoinCode(host.page);
      await sync.identifyFromShareSheet(host.page, "F1");
      await handEntry.playDeal(host.page, { bidder: { seat: 0 }, bid: 7, pointsTaken: 9 });
      await host.page.waitForTimeout(config.syncSettleMs);

      const before = await handEntry.recordDealState(host.page);
      const beforeStatus = await sync.syncStatus(host.page);
      if (before.state !== "ready" || beforeStatus.label !== "Live") {
        await logger.record({
          severity: "high",
          category: "test-precondition",
          summary: `Fresh session should be writable and read "Live" (got state=${before.state}, label=${beforeStatus.label})`,
          page: host.page,
          contextLabel: "host",
        });
        return;
      }

      logger.step("Age the session past the 48h write window (still inside the 30d read window)");
      await emulator.dbSet(`tournaments/${code}/_createdAt`, Date.now() - 5 * 24 * 3600 * 1000);
      // The client reads _createdAt off its synced snapshot, so wait for the
      // change to land rather than assuming the next render sees it.
      await host.page.waitForTimeout(config.syncSettleMs);

      const after = await handEntry.recordDealState(host.page);
      if (after.state === "ready" || after.state === "take") {
        await logger.record({
          severity: "high",
          category: "regression-repro",
          summary: `A frozen session still offers a record-deal button (state=${after.state}) -- tapping it hits a server-denied write and reports "Someone else just started entering this hand."`,
          expected: "no record affordance",
          actual: after.state,
          page: host.page,
          contextLabel: "host",
        });
      }
      const bar = await host.page.locator(".view-only-bar:visible").allTextContents();
      if (!bar.some((t) => /Archived/i.test(t))) {
        await logger.record({
          severity: "high",
          category: "regression-repro",
          summary: `Frozen session shows no "Archived" explanation on the pad (bars: ${JSON.stringify(bar)})`,
          expected: 'a bar saying the session is archived',
          actual: JSON.stringify(bar),
          page: host.page,
          contextLabel: "host",
        });
      }
      if (bar.some((t) => /Someone else/i.test(t))) {
        await logger.record({
          severity: "critical",
          category: "regression-repro",
          summary: `Frozen session blames another device ("${bar.find((t) => /Someone else/i.test(t))}") for what is really an expired session`,
          page: host.page,
          contextLabel: "host",
        });
      }
      const status = await sync.syncStatus(host.page);
      if (status.label === "Live") {
        await logger.record({
          severity: "medium",
          category: "regression-repro",
          summary: 'A frozen session still reports "Live" -- the connection is live but nothing can be written through it',
          expected: "Archived: read-only",
          actual: status.label,
          page: host.page,
          contextLabel: "host",
        });
      }

      // The whole reason the read window outlives the write window: History
      // still syncs. Freezing the pad must not have frozen that too.
      logger.step("History sync must keep working while the pad is read-only");
      const recs = ((await storage.readKey(host.page, storage.KEYS.history)).value || []);
      const uid = (await storage.readKey(host.page, storage.KEYS.authUid)).raw;
      if (uid && recs.length) {
        const cloud = await emulator.pollFor(async () => {
          const v = await emulator.dbGet(`users/${uid}/history/${recs[0].id}`);
          return v || null;
        });
        if (!cloud) {
          await logger.record({
            severity: "high",
            category: "sync-divergence",
            summary: "Archived session stopped History from reaching the cloud -- read-only must apply to the shared session, not the device's own backup",
            page: host.page,
            contextLabel: "host",
          });
        }
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

module.exports = [
  shareGameHostGuest,
  bestOf1LogsWithoutContinue,
  loneSharedGameIsStandard,
  decidingDealCorrectionPropagates,
  decidingDealCorrectionRepairsOnRejoin,
  missedGamesBackfillOnRejoin,
  frozenSessionIsReadOnly,
];

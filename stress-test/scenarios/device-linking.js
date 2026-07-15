"use strict";
const browserLib = require("../lib/browser");
const nav = require("../lib/pageobjects/nav");
const seats = require("../lib/pageobjects/seats");
const sync = require("../lib/pageobjects/sync");
const tSetup = require("../lib/pageobjects/tournamentSetup");
const newGame = require("../lib/pageobjects/newGame");
const linking = require("../lib/pageobjects/linking");
const stats = require("../lib/pageobjects/stats");
const storage = require("../lib/pageobjects/storage");
const history = require("../lib/pageobjects/history");
const simulator = require("../lib/simulator");
const config = require("../config");

const invalidLinkCode = {
  name: "device-linking/invalid-link-code",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("device-linking/invalid-link-code");
    const device = await browserLib.createDevice(browser, { label: "solo", scenarioLogger: logger });
    try {
      await linking.openDisplaySheet(device.page);
      await linking.openLinkDeviceSheet(device.page);
      await device.page.waitForTimeout(1500); // let Firebase's connection establish, mirrors invalid-join-code
      await linking.redeemLinkCode(device.page, "ZZZZZZ");
      const err = await linking.linkErrorText(device.page);
      if (!err || !/no link code found/i.test(err)) {
        await logger.record({
          severity: "medium",
          category: "correctness",
          summary: `Redeeming a nonexistent link code should show "No link code found." (same PERMISSION_DENIED-vs-null subtlety as joining a bad tournament code -- see sync-cross-cutting/invalid-join-code), got "${err}"`,
          expected: "No link code found.",
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

const offlineLocalOnlyFallback = {
  name: "device-linking/offline-local-only-fallback",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("device-linking/offline-local-only-fallback");
    const device = await browserLib.createDevice(browser, { label: "solo", scenarioLogger: logger });
    try {
      // Never opens the link-device sheet or enables cloud sync -- this is the
      // default state every existing user is in. History/Stats must behave
      // exactly as before; console-error capture (wired in createDevice) is
      // the regression guard for the new sync code paths firing unexpectedly.
      await seats.nameAllSeats(device.page, ["F1", "F2", "F3", "F4"]);
      await simulator.playDealsToCompletion(device.page, {
        bidderFor: simulator.namedBidderFor,
        seed: 3003,
        logger,
        contextLabel: "solo",
      });
      await newGame.dismissPlayAgainOffer(device.page);

      const cloudSync = await storage.readKey(device.page, storage.KEYS.cloudSyncEnabled);
      if (cloudSync.value) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: "cloudSyncEnabled became true without the device ever opting in via the link-device sheet",
          expected: null,
          actual: cloudSync.value,
          page: device.page,
        });
      }

      const played = await stats.readGamesPlayed(device.page, "F1");
      if (played !== 1) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: `A non-opted-in device's own Stats should be unaffected by the merge machinery (mergedHistoryForStats degenerates to gameHistory alone) -- expected 1 game played for F1, got ${played}`,
          expected: 1,
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

const linkAndSyncHistory = {
  name: "device-linking/link-and-sync-history",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("device-linking/link-and-sync-history");
    const deviceA = await browserLib.createDevice(browser, { label: "deviceA", scenarioLogger: logger });
    const deviceB = await browserLib.createDevice(browser, { label: "deviceB", scenarioLogger: logger });
    try {
      logger.step("Device A: play and archive a local game before ever linking (exercises the back-fill path)");
      await seats.nameAllSeats(deviceA.page, ["A1", "A2", "A3", "A4"]);
      await simulator.playDealsToCompletion(deviceA.page, {
        bidderFor: simulator.namedBidderFor,
        seed: 4004,
        logger,
        contextLabel: "deviceA",
      });
      await newGame.dismissPlayAgainOffer(deviceA.page);

      logger.step("Device A generates a link code, Device B redeems it");
      const code = await linking.linkDevices(deviceA, deviceB);
      if (!code || code.length !== 6) {
        await logger.record({
          severity: "critical",
          category: "correctness",
          summary: `generateLinkCode produced an unexpected code: "${code}"`,
          page: deviceA.page,
          contextLabel: "deviceA",
        });
        return;
      }

      logger.step("Both devices should now share the same personId and see both uids in linkedUids");
      // personId/authUid are plain (non-JSON) localStorage strings -- storage.readKey's
      // value is JSON.parse'd and comes back null for these, use .raw instead.
      const [personA, personB] = await Promise.all([
        storage.readKey(deviceA.page, storage.KEYS.personId),
        storage.readKey(deviceB.page, storage.KEYS.personId),
      ]);
      if (!personA.raw || personA.raw !== personB.raw) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Device A and B disagree on personId after linking (A="${personA.raw}", B="${personB.raw}")`,
          expected: "equal, non-null personId on both devices",
          actual: { a: personA.raw, b: personB.raw },
          pages: { deviceA: deviceA.page, deviceB: deviceB.page },
        });
      }
      const linkedB = (await storage.readKey(deviceB.page, storage.KEYS.linkedUids)).value || [];
      const authA = (await storage.readKey(deviceA.page, storage.KEYS.authUid)).raw;
      if (!authA || linkedB.indexOf(authA) === -1) {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Device B's linkedUids does not include Device A's uid after redeeming A's link code`,
          expected: `linkedUids to contain "${authA}"`,
          actual: linkedB,
          page: deviceB.page,
          contextLabel: "deviceB",
        });
      }

      logger.step("Device B's Stats should reflect Device A's pre-link game once cloud sync propagates");
      const played = await stats.pollGamesPlayed(deviceB.page, "A1", 1);
      if (played !== 1) {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Device B's Stats should show 1 game played for "A1" (Device A's pre-link game, back-filled via syncHistoryToCloud on enableCloudSync then picked up by Device B's subscribeLinkedHistories), got ${played}`,
          expected: 1,
          actual: played,
          pages: { deviceA: deviceA.page, deviceB: deviceB.page },
        });
      }

      // The reverse direction is the one a redeemer-side check can't cover: the
      // GENERATOR must merge the redeemer's games in the same session. This held
      // "green" for a while purely by accident -- generateLinkCode never
      // subscribed to linked histories (enableCloudSync now owns that wiring),
      // and no assertion looked at a B-only game from A's side.
      logger.step("Device B plays a post-link game; Device A (the code generator) must see it in Stats without a reload");
      // Same precondition as unlink-stops-merging: wait for A's membership
      // listener to register B before B plays, so A has a listener on B's
      // history. (Passed incidentally before via the B-reads-A1 navigation
      // above, but that grace isn't guaranteed under load -- make it explicit.)
      const bUidPostLink = (await storage.readKey(deviceB.page, storage.KEYS.authUid)).raw;
      if (!(await linking.waitForLinkedUid(deviceA.page, bUidPostLink))) {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Device A's membership listener never registered Device B's uid (${bUidPostLink}) within 15s of linking`,
          page: deviceA.page,
          contextLabel: "deviceA",
        });
        return;
      }
      await nav.goto(deviceB.page, "Game");   // readGamesPlayed above left B on History/Stats
      await seats.nameAllSeats(deviceB.page, ["B1", "B2", "B3", "B4"]);
      await simulator.playDealsToCompletion(deviceB.page, {
        bidderFor: simulator.namedBidderFor,
        seed: 4104,
        logger,
        contextLabel: "deviceB",
      });
      await newGame.dismissPlayAgainOffer(deviceB.page);
      const playedOnA = await stats.pollGamesPlayed(deviceA.page, "B1", 1);
      if (playedOnA !== 1) {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Device A's Stats should show 1 game played for "B1" (Device B's post-link game, merged via the generator's own subscribeLinkedHistories) without reloading Device A, got ${playedOnA}`,
          expected: 1,
          actual: playedOnA,
          pages: { deviceA: deviceA.page, deviceB: deviceB.page },
        });
      }
    } catch (e) {
      await logger.record({
        severity: "high",
        category: "scenario-crash",
        summary: `Scenario threw: ${e.message}`,
        actual: e.stack,
        pages: { deviceA: deviceA.page, deviceB: deviceB.page },
      });
    } finally {
      await browserLib.closeDevice(deviceA);
      await browserLib.closeDevice(deviceB);
    }
  },
};

// Direct regression guard for the matchUid dedup fix (buildHistoryRecordForMatch
// / mergedHistoryForStats): a shared match gets archived independently by EVERY
// device that identified as a player in it (see casual-shared/share-game-host-
// guest-identity-autoarchive, which already proves each device's own History
// ends up with exactly 1 entry, same matchUid, different random id). Once those
// two devices are ALSO linked via a device-link-code, their Stats merge -- and
// without matchUid-based dedup, every player in that match would be double
// counted (both host's and guest's copy of the same match carry the full
// 4-player roster).
const sharedMatchNotDoubleCounted = {
  name: "device-linking/shared-match-not-double-counted",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("device-linking/shared-match-not-double-counted");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    try {
      logger.step("Host: name seats, share this game");
      await seats.nameAllSeats(host.page, ["H1", "H2", "H3", "H4"]);
      await sync.shareFromGameOptions(host.page);
      const joinCode = await sync.readJoinCode(host.page);
      await sync.identifyFromShareSheet(host.page, "H1");

      logger.step(`Guest joins with ${joinCode} and identifies as H3`);
      await nav.goto(guest.page, "Tournament");
      await tSetup.openJoinSheet(guest.page);
      await sync.joinWithCode(guest.page, joinCode);
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
      if (await sync.whoSheet(guest.page).count()) {
        await sync.chooseIdentity(guest.page, "H3");
      }

      logger.step("Link host and guest as the same person (separate from the tournament join-code above)");
      await linking.linkDevices(host, guest);

      logger.step("Host plays the game to completion and taps through Continue / decline the series offer");
      await host.page.waitForTimeout(config.syncSettleMs);
      await simulator.playDealsToCompletion(host.page, {
        bidderFor: simulator.namedBidderFor,
        seed: 5005,
        logger,
        contextLabel: "host",
      });
      await newGame.continueSharedGame(host.page);
      await newGame.dismissPlayAgainOffer(host.page);

      logger.step("Wait for both devices' History to sync up and cross-merge, then check Stats");
      await guest.page.waitForTimeout(config.syncSettleMs);
      await host.page.waitForTimeout(config.syncSettleMs);

      const hostPlayed = await stats.readGamesPlayed(host.page, "H1");
      if (hostPlayed !== 1) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `H1's games-played should be 1 (host's own archived copy and guest's independently-archived copy of the SAME match share a matchUid and must dedup on merge), got ${hostPlayed} on host's own device`,
          expected: 1,
          actual: hostPlayed,
          pages: { host: host.page, guest: guest.page },
        });
      }
      const guestPlayed = await stats.readGamesPlayed(guest.page, "H3");
      if (guestPlayed !== 1) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `H3's games-played should be 1 on guest's own device after merging with host's linked History, got ${guestPlayed}`,
          expected: 1,
          actual: guestPlayed,
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

// Regression guard for the unlink flow (unlinkDevice + Display-sheet UI,
// SECURITY_REVIEW.md #11): after a device unlinks, it must (a) revert its own
// local link state, (b) stop merging the formerly-linked device's games into
// its Stats, and (c) keep its OWN History intact -- unlink is "leave the group,"
// not "wipe my data."
const unlinkStopsMerging = {
  name: "device-linking/unlink-stops-merging",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("device-linking/unlink-stops-merging");
    const deviceA = await browserLib.createDevice(browser, { label: "deviceA", scenarioLogger: logger });
    const deviceB = await browserLib.createDevice(browser, { label: "deviceB", scenarioLogger: logger });
    try {
      logger.step("Device A plays a local game, then links Device B");
      await seats.nameAllSeats(deviceA.page, ["UA1", "UA2", "UA3", "UA4"]);
      await simulator.playDealsToCompletion(deviceA.page, {
        bidderFor: simulator.namedBidderFor,
        seed: 6006,
        logger,
        contextLabel: "deviceA",
      });
      await newGame.dismissPlayAgainOffer(deviceA.page);
      await linking.linkDevices(deviceA, deviceB);

      // Synchronize on the real precondition before B plays: A's membership
      // listener must have registered B, which is when A attaches B's history
      // listener. Racing B's game ahead of this is what made the merge check
      // flaky. Waits on actual state, not a fixed sleep.
      const bUidForWait = (await storage.readKey(deviceB.page, storage.KEYS.authUid)).raw;
      if (!(await linking.waitForLinkedUid(deviceA.page, bUidForWait))) {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Device A's membership listener never registered Device B's uid (${bUidForWait}) within 15s of linking -- linkedUids fan-out did not propagate`,
          page: deviceA.page,
          contextLabel: "deviceA",
        });
        return;
      }

      logger.step("Device B plays its own game; Device A should merge it in while linked");
      await nav.goto(deviceB.page, "Game");
      await seats.nameAllSeats(deviceB.page, ["UB1", "UB2", "UB3", "UB4"]);
      await simulator.playDealsToCompletion(deviceB.page, {
        bidderFor: simulator.namedBidderFor,
        seed: 6106,
        logger,
        contextLabel: "deviceB",
      });
      await newGame.dismissPlayAgainOffer(deviceB.page);
      const mergedBefore = await stats.pollGamesPlayed(deviceA.page, "UB1", 1);
      if (mergedBefore !== 1) {
        // Diagnostic: did A's membership listener ever see B? linkedUids is
        // written by subscribeLinkedHistories on every membership snapshot, so
        // if it contains B's uid the listener fired and the gap is in the
        // history-merge path; if not, it's membership-listener propagation.
        const aLinked = (await storage.readKey(deviceA.page, storage.KEYS.linkedUids)).value || [];
        const bUid = (await storage.readKey(deviceB.page, storage.KEYS.authUid)).raw;
        const aUid = (await storage.readKey(deviceA.page, storage.KEYS.authUid)).raw;
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Pre-unlink sanity: Device A should see Device B's game (UB1) merged, got ${mergedBefore}. DIAG: A.linkedUids=${JSON.stringify(aLinked)} A.uid=${aUid} B.uid=${bUid} B-in-A.linkedUids=${aLinked.indexOf(bUid) !== -1}`,
          expected: 1,
          actual: mergedBefore,
          pages: { deviceA: deviceA.page, deviceB: deviceB.page },
        });
        return;
      }

      logger.step("Device A unlinks; its link state must revert and B's game must drop out of A's Stats");
      await linking.unlinkThisDevice(deviceA.page);

      const cloudSync = await storage.readKey(deviceA.page, storage.KEYS.cloudSyncEnabled);
      if (cloudSync.value) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: "After unlink, cloudSyncEnabled should be cleared on Device A",
          expected: null,
          actual: cloudSync.value,
          page: deviceA.page,
          contextLabel: "deviceA",
        });
      }
      const personA = await storage.readKey(deviceA.page, storage.KEYS.personId);
      if (personA.raw) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: `After unlink, personId should be cleared on Device A, still "${personA.raw}"`,
          expected: null,
          actual: personA.raw,
          page: deviceA.page,
          contextLabel: "deviceA",
        });
      }

      // B's game must no longer merge in; A's own game must survive.
      const mergedAfter = await stats.readGamesPlayed(deviceA.page, "UB1");
      if (mergedAfter !== 0) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: `After unlink, Device B's game (UB1) must NOT appear in Device A's Stats, got ${mergedAfter}`,
          expected: 0,
          actual: mergedAfter,
          pages: { deviceA: deviceA.page, deviceB: deviceB.page },
        });
      }
      const ownAfter = await stats.readGamesPlayed(deviceA.page, "UA1");
      if (ownAfter !== 1) {
        await logger.record({
          severity: "critical",
          category: "correctness",
          summary: `Unlink must not touch Device A's own History -- expected 1 game played for UA1, got ${ownAfter}`,
          expected: 1,
          actual: ownAfter,
          page: deviceA.page,
          contextLabel: "deviceA",
        });
      }
    } catch (e) {
      await logger.record({
        severity: "high",
        category: "scenario-crash",
        summary: `Scenario threw: ${e.message}`,
        actual: e.stack,
        pages: { deviceA: deviceA.page, deviceB: deviceB.page },
      });
    } finally {
      await browserLib.closeDevice(deviceA);
      await browserLib.closeDevice(deviceB);
    }
  },
};

// Regression guard for SECURITY_REVIEW.md #10 (link codes were multi-use,
// unrevocable, and immortal for their whole 30-minute window): commitLinkCode
// now deletes the code the moment it's redeemed, so a second device that
// somehow still has the code (shoulder-surfed, screenshotted, pasted into the
// wrong chat) can no longer join with it.
//
// This deliberately does NOT use linking.linkDevices() -- that helper ends by
// calling closeLinkDeviceSheet(deviceA.page), which *also* deletes an
// outstanding code once A's sheet is on the "show" step, regardless of
// whether B ever redeemed it. Using it here would let the test pass even if
// commitLinkCode's redeem-time delete were removed entirely, since A's own
// cleanup would still make the code gone by the time C tries it. Instead,
// device A's "show code" sheet is left open through C's attempt (only closed
// at the very end), and B's join is asserted before C ever tries -- so the
// only thing that can have consumed the code by the time C tries it is B's
// own redemption.
const linkCodeSingleUse = {
  name: "device-linking/link-code-single-use",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("device-linking/link-code-single-use");
    const deviceA = await browserLib.createDevice(browser, { label: "deviceA", scenarioLogger: logger });
    const deviceB = await browserLib.createDevice(browser, { label: "deviceB", scenarioLogger: logger });
    const deviceC = await browserLib.createDevice(browser, { label: "deviceC", scenarioLogger: logger });
    try {
      logger.step("Device A generates a code (sheet stays open -- not using linkDevices()'s auto-close)");
      await linking.openDisplaySheet(deviceA.page);
      await linking.openLinkDeviceSheet(deviceA.page);
      const code = await linking.generateLinkCode(deviceA.page);
      if (!code || code.length !== 6) {
        await logger.record({
          severity: "critical",
          category: "correctness",
          summary: `generateLinkCode produced an unexpected code: "${code}"`,
          page: deviceA.page,
          contextLabel: "deviceA",
        });
        return;
      }
      await deviceA.page.waitForTimeout(config.syncSettleMs);

      logger.step("Device B redeems it (this, not A's cleanup, must be what consumes it)");
      await linking.openDisplaySheet(deviceB.page);
      await linking.openLinkDeviceSheet(deviceB.page);
      await linking.redeemLinkCode(deviceB.page, code);
      await deviceB.page.waitForTimeout(config.syncSettleMs);

      const personB = await storage.readKey(deviceB.page, storage.KEYS.personId);
      if (!personB.raw) {
        await logger.record({
          severity: "critical",
          category: "correctness",
          summary: `Device B must have actually joined the group after redeeming a valid code, but personId is unset -- can't test single-use without a real redemption`,
          expected: "a personId",
          actual: personB.raw,
          page: deviceB.page,
          contextLabel: "deviceB",
        });
        return;
      }

      logger.step("Device C tries to redeem the SAME code, while A's sheet is still open -- it should already be consumed and gone because B redeemed it");
      await linking.openDisplaySheet(deviceC.page);
      await linking.openLinkDeviceSheet(deviceC.page);
      await deviceC.page.waitForTimeout(1000);
      await linking.redeemLinkCode(deviceC.page, code);
      const err = await linking.linkErrorText(deviceC.page);
      if (!err || !/no link code found/i.test(err)) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: `A redeemed link code must be consumed and unredeemable a second time -- expected "No link code found.", got "${err}"`,
          expected: "No link code found.",
          actual: err,
          page: deviceC.page,
          contextLabel: "deviceC",
        });
      }
      const personC = await storage.readKey(deviceC.page, storage.KEYS.personId);
      if (personC.raw) {
        await logger.record({
          severity: "critical",
          category: "correctness",
          summary: `Device C must not have joined the group via a stale, already-redeemed code, but personId="${personC.raw}"`,
          expected: null,
          actual: personC.raw,
          page: deviceC.page,
          contextLabel: "deviceC",
        });
      }

      await linking.closeLinkDeviceSheet(deviceA.page);
    } catch (e) {
      await logger.record({
        severity: "high",
        category: "scenario-crash",
        summary: `Scenario threw: ${e.message}`,
        actual: e.stack,
        pages: { deviceA: deviceA.page, deviceB: deviceB.page, deviceC: deviceC.page },
      });
    } finally {
      await browserLib.closeDevice(deviceA);
      await browserLib.closeDevice(deviceB);
      await browserLib.closeDevice(deviceC);
    }
  },
};

// Regression guard for SECURITY_REVIEW.md C4: deleting a shared match on one
// device didn't stick -- the linked device's independently-archived copy of
// the same matchUid resurrected it in merged Stats. Same host+guest shared-
// match setup as sharedMatchNotDoubleCounted, but after confirming both sides
// merge to 1, the host deletes its own copy and must drop to 0 -- without a
// matchUid tombstone, mergedHistoryForStats would still find the guest's copy
// in linkedHistoryCache and count it.
const deletedSharedMatchStaysDeleted = {
  name: "device-linking/deleted-shared-match-stays-deleted",
  phase: "sync",
  run: async ({ browser, store }) => {
    const logger = store.newScenario("device-linking/deleted-shared-match-stays-deleted");
    const host = await browserLib.createDevice(browser, { label: "host", scenarioLogger: logger });
    const guest = await browserLib.createDevice(browser, { label: "guest", scenarioLogger: logger });
    try {
      logger.step("Host: name seats, share this game");
      await seats.nameAllSeats(host.page, ["DH1", "DH2", "DH3", "DH4"]);
      await sync.shareFromGameOptions(host.page);
      const joinCode = await sync.readJoinCode(host.page);
      await sync.identifyFromShareSheet(host.page, "DH1");

      logger.step(`Guest joins with ${joinCode} and identifies as DH3`);
      await nav.goto(guest.page, "Tournament");
      await tSetup.openJoinSheet(guest.page);
      await sync.joinWithCode(guest.page, joinCode);
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
      if (await sync.whoSheet(guest.page).count()) {
        await sync.chooseIdentity(guest.page, "DH3");
      }

      logger.step("Link host and guest as the same person");
      await linking.linkDevices(host, guest);
      const guestUid = (await storage.readKey(guest.page, storage.KEYS.authUid)).raw;
      if (!(await linking.waitForLinkedUid(host.page, guestUid))) {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `Host's membership listener never registered Guest's uid (${guestUid}) within 15s of linking`,
          page: host.page,
          contextLabel: "host",
        });
        return;
      }

      logger.step("Host plays the game to completion; both sides should merge to 1 game played");
      await host.page.waitForTimeout(config.syncSettleMs);
      await simulator.playDealsToCompletion(host.page, {
        bidderFor: simulator.namedBidderFor,
        seed: 7007,
        logger,
        contextLabel: "host",
      });
      await newGame.continueSharedGame(host.page);
      await newGame.dismissPlayAgainOffer(host.page);
      await guest.page.waitForTimeout(config.syncSettleMs);
      await host.page.waitForTimeout(config.syncSettleMs);

      const hostBefore = await stats.readGamesPlayed(host.page, "DH1");
      if (hostBefore !== 1) {
        await logger.record({
          severity: "critical",
          category: "sync-divergence",
          summary: `Pre-delete sanity: host's games-played for DH1 should be 1, got ${hostBefore}`,
          expected: 1,
          actual: hostBefore,
          pages: { host: host.page, guest: guest.page },
        });
        return;
      }

      logger.step("Host deletes its own copy of the match from History");
      await nav.goto(host.page, "History");
      const recIds = await history.entryIds(host.page);
      if (recIds.length !== 1) {
        await logger.record({
          severity: "high",
          category: "correctness",
          summary: `Host's History should show exactly 1 entry for the shared match before deleting, got ${recIds.length}`,
          expected: 1,
          actual: recIds.length,
          page: host.page,
          contextLabel: "host",
        });
        return;
      }
      await history.deleteEntry(host.page, recIds[0]);
      await host.page.waitForTimeout(config.syncSettleMs);

      logger.step("Host's games-played must drop to 0 -- the guest's linked copy must not resurrect it");
      const hostAfter = await stats.readGamesPlayed(host.page, "DH1");
      if (hostAfter !== 0) {
        await logger.record({
          severity: "high",
          category: "sync-divergence",
          summary: `After deleting the shared match on host, host's games-played for DH1 should be 0 (the guest's independently-archived copy of the same matchUid must not resurrect it via mergedHistoryForStats), got ${hostAfter}`,
          expected: 0,
          actual: hostAfter,
          pages: { host: host.page, guest: guest.page },
        });
      }

      logger.step("Guest, who never deleted anything, should still see its own copy (documented: deletion doesn't propagate)");
      const guestAfter = await stats.readGamesPlayed(guest.page, "DH3");
      if (guestAfter !== 1) {
        await logger.record({
          severity: "medium",
          category: "sync-divergence",
          summary: `Guest's own games-played for DH3 should be unaffected by host's local delete, got ${guestAfter}`,
          expected: 1,
          actual: guestAfter,
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

module.exports = [invalidLinkCode, offlineLocalOnlyFallback, linkAndSyncHistory, sharedMatchNotDoubleCounted, unlinkStopsMerging, linkCodeSingleUse, deletedSharedMatchStaysDeleted];

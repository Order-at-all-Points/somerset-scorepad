"use strict";
/**
 * Regression guards for Cloud Backup + Stats Sharing, from the 2026-07-16
 * stress investigation (full writeup: CLOUD_SYNC_STRESS_2026-07-16.md).
 *
 * These run in the "sharing" phase, and reset the shared local Firebase
 * emulator database between scenarios (every phase now runs against the
 * local emulators, never production -- see lib/browser.js createDevice() and
 * lib/emulator.js) -- this phase additionally needs the emulator's
 * ?access_token=owner ground-truth reads and deliberately drives revocation
 * failures, which is why it's kept separate and gated on emulator.isUp().
 *
 * Every guard here asserts the DESIRED behaviour, so each one currently FAILS
 * against the shipped code by design: they were written from confirmed bugs
 * (F1-F6) and are what a fix has to turn green. A guard that passes before the
 * fix would be proving nothing.
 *
 * The load-bearing distinction throughout: dbGet() bypasses rules and only
 * shows what is STORED; emulator.readAs() is a rules-enforced read from a
 * device's own authenticated session and is the only honest proof of ACCESS.
 */
const fs = require("fs");
const path = require("path");
const browserLib = require("../lib/browser");
const emulator = require("../lib/emulator");
const nav = require("../lib/pageobjects/nav");
const seats = require("../lib/pageobjects/seats");
const sync = require("../lib/pageobjects/sync");
const tSetup = require("../lib/pageobjects/tournamentSetup");
const newGame = require("../lib/pageobjects/newGame");
const linking = require("../lib/pageobjects/linking");
const sharing = require("../lib/pageobjects/sharing");
const storage = require("../lib/pageobjects/storage");
const simulator = require("../lib/simulator");
const config = require("../config");

const LS = {
  profileId: "somerset:dev-profile-id",
  autoShare: "somerset:dev-auto-share",
  sharePeers: "somerset:dev-share-peers",
};

async function readLS(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

/** An emulator-wired device. Skips the auth throttle (no limits locally). */
async function makeDevice(browser, logger, label, extraInit) {
  return browserLib.createDevice(browser, {
    label,
    scenarioLogger: logger,
    throttleAuth: false,
    contextInit: async (context) => {
      await emulator.wireToEmulators(context);
      if (extraInit) await extraInit(context);
    },
  });
}

/**
 * Alice and Bob each backing up + sharing, then one shared game between them,
 * which is what mints the mutual grants. Returns the ids the guards assert on.
 * Throws if the fixture itself doesn't come up -- a broken fixture must not be
 * reported as the bug under test.
 */
async function establishMutualSharing(browser, logger, { seed = 4242 } = {}) {
  const alice = await makeDevice(browser, logger, "alice");
  const bob = await makeDevice(browser, logger, "bob");

  if (!(await linking.enableBackupViaToggle(alice.page))) throw new Error("fixture: Alice's backup never turned on");
  if ((await sharing.setMaster(alice.page, true)) !== true) throw new Error("fixture: Alice's sharing never turned on");
  const alicePid = await readLS(alice.page, LS.profileId);

  if (!(await linking.enableBackupViaToggle(bob.page))) throw new Error("fixture: Bob's backup never turned on");
  if ((await sharing.setMaster(bob.page, true)) !== true) throw new Error("fixture: Bob's sharing never turned on");
  const bobPid = await readLS(bob.page, LS.profileId);
  if (!alicePid || !bobPid || alicePid === bobPid) throw new Error(`fixture: bad profileIds ${alicePid}/${bobPid}`);

  // Shared game: Alice hosts, Bob joins, both identify, Alice plays it out.
  await seats.nameAllSeats(alice.page, ["Alice", "Bob", "Carol", "Dave"]);
  await sync.shareFromGameOptions(alice.page);
  const code = await sync.readJoinCode(alice.page);
  await sync.identifyFromShareSheet(alice.page, "Alice");
  await nav.goto(bob.page, "Tournament");
  await tSetup.openJoinSheet(bob.page);
  await sync.joinWithCode(bob.page, code);
  await bob.page.waitForTimeout(400);
  if ((await bob.page.locator('[role="dialog"][aria-label="Identify yourself"]').count()) > 0) {
    await sync.chooseIdentity(bob.page, "Bob");
  }
  await simulator.playDealsToCompletion(alice.page, {
    bidderFor: simulator.namedBidderFor, seed, logger, contextLabel: "alice",
  });
  await newGame.continueSharedGame(alice.page);
  await newGame.dismissPlayAgainOffer(alice.page);

  const granted = await emulator.pollFor(async () => {
    const a = await emulator.dbGet(`statsProfiles/${alicePid}/allowed`);
    return a && a[bobPid] ? a : null;
  });
  if (!granted) throw new Error("fixture: Alice never granted Bob after the shared game");
  // The digest publish is debounced 2s AND unlinkDevice() clears the pending
  // timer -- without waiting for it to land, an unlink below would silently
  // cancel it and the guard would assert against a profile that never had one.
  const digest = await emulator.pollFor(async () => {
    const d = await emulator.dbGet(`statsProfiles/${alicePid}/digest`);
    return d && d.name ? d : null;
  });
  if (!digest) throw new Error("fixture: Alice's digest never published");

  return { alice, bob, alicePid, bobPid, code };
}

/** Can `device` actually read `pid`'s digest right now, per the rules? */
async function canReadDigest(device, pid) {
  const r = await emulator.readAs(device, `statsProfiles/${pid}/digest`);
  return !!(r.ok && r.val && r.val.name);
}

/** Wraps a guard body with emulator reset + device cleanup + crash reporting. */
function guard(name, body) {
  return {
    name,
    phase: "sharing",
    run: async ({ browser, store }) => {
      const logger = store.newScenario(name);
      const devices = [];
      try {
        await emulator.dbReset();
        await body({ browser, logger, track: (d) => { devices.push(d); return d; } });
      } catch (e) {
        await logger.record({
          severity: "high",
          category: "scenario-crash",
          summary: `Scenario threw: ${e.message}`,
          actual: e.stack,
        });
      } finally {
        for (const d of devices) await browserLib.closeDevice(d);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// F1 -- turning Cloud Backup off must actually stop sharing, not just relabel it
// ---------------------------------------------------------------------------
const backupOffStopsSharing = guard("stats-sharing/backup-off-stops-sharing", async ({ browser, logger, track }) => {
  const { alice, bob, alicePid, bobPid } = await establishMutualSharing(browser, logger);
  track(alice); track(bob);

  if (!(await canReadDigest(bob, alicePid))) {
    await logger.record({
      severity: "high", category: "fixture",
      summary: "Baseline failed: Bob could not read Alice's digest even before she turned backup off",
      page: bob.page,
    });
    return;
  }

  await linking.unlinkThisDevice(alice.page);
  await alice.page.waitForTimeout(config.syncSettleMs);

  // What the app TELLS her.
  const rowState = await sharing.displayRowState(alice.page);
  await sharing.closeSheet(alice.page);

  // What is actually true.
  const stillReadable = await canReadDigest(bob, alicePid);
  const allowed = await emulator.dbGet(`statsProfiles/${alicePid}/allowed`);

  if (rowState === "Off" && stillReadable) {
    await logger.record({
      severity: "high",
      category: "privacy",
      summary:
        "Turning off Cloud Backup makes the Display sheet report \"Stats Sharing: Off\" while the digest stays " +
        "published and readable by a follower. The On/Off row renders statsSharingOn() (index.html:4364), which " +
        "is autoShare && cloudSyncEnabled && authUid && fb -- connectivity, not whether sharing was revoked. " +
        "unlinkDevice() (1409) tears down listeners but never revokes, and the sharing sheet gates the master " +
        "toggle on cloudSyncEnabled (4406), so the only control that could revoke is hidden exactly when it is " +
        "needed. See CLOUD_SYNC_STRESS_2026-07-16.md F1.",
      expected: "Stats Sharing reported Off => follower's read of the digest is denied",
      actual: `row shows "${rowState}" but Bob still reads Alice's digest; allowed/ = ${JSON.stringify(allowed)}`,
      page: alice.page,
    });
  }

  // The dead end: with backup off there is no way back to a revoke control.
  await sharing.openSheet(alice.page);
  const noToggle = (await sharing.masterToggle(alice.page).count()) === 0;
  const deadEnd = await sharing.isBackupOffBranch(alice.page);
  await sharing.closeSheet(alice.page);
  if (noToggle && deadEnd && stillReadable) {
    await logger.record({
      severity: "medium",
      category: "privacy",
      summary:
        "With Cloud Backup off and sharing still live server-side, the Stats Sharing sheet offers only " +
        "\"Set up Cloud Backup\" -- the master toggle isn't rendered, so the user has no path to revoke.",
      expected: "a reachable control to stop sharing",
      actual: "sharing sheet shows only the backup-off branch",
      page: alice.page,
    });
  }
});

// ---------------------------------------------------------------------------
// F2 -- a linked device must be able to revoke grants made on its sibling
// ---------------------------------------------------------------------------
const linkedDeviceCanRevoke = guard("stats-sharing/linked-device-can-revoke", async ({ browser, logger, track }) => {
  const { alice, bob, alicePid, bobPid } = await establishMutualSharing(browser, logger, { seed: 99 });
  track(alice); track(bob);

  // Alice adds a second device AFTER the grant exists, then tries to cut Bob
  // off from it -- the "I'll do it on my tablet" path.
  const tablet = track(await makeDevice(browser, logger, "alice-tablet"));
  await linking.linkDevices(alice, tablet);
  const aliceUid = (await storage.readKey(alice.page, storage.KEYS.authUid)).raw;
  await linking.waitForLinkedUid(tablet.page, aliceUid, 15);
  await sharing.setMaster(tablet.page, true);

  const tabletPid = await readLS(tablet.page, LS.profileId);
  if (tabletPid !== alicePid) {
    await logger.record({
      severity: "high", category: "correctness",
      summary: "A linked device minted its own statsProfile instead of adopting the person's existing one",
      expected: alicePid, actual: tabletPid, page: tablet.page,
    });
    return;
  }

  await sharing.openSheet(tablet.page);
  const rows = await sharing.peerRowCount(tablet.page);
  await sharing.closeSheet(tablet.page);

  await sharing.setMaster(tablet.page, false);
  await tablet.page.waitForTimeout(config.syncSettleMs);

  if (await canReadDigest(bob, alicePid)) {
    await logger.record({
      severity: "high",
      category: "privacy",
      summary:
        "Turning Stats Sharing off on a linked device revokes nothing: Bob still reads the person's digest. " +
        "setStatsSharing(false) (index.html:2368) iterates sharePeers, but restorePeersFromCloud (2272) only " +
        "reads users/<OWN uid>/sharePeers -- the peer roster is per-device while allowed/ is per-person, so " +
        "grants made on a sibling device are invisible and unrevocable from here. History fans out across " +
        "linkedUids (subscribeLinkedHistories, 1367); the peer roster never does. " +
        "See CLOUD_SYNC_STRESS_2026-07-16.md F2.",
      expected: "master-off on any of the person's devices revokes every grant on that person's profile",
      actual: `tablet's People list showed ${rows} row(s); after master-off Bob still reads the digest`,
      page: tablet.page,
    });
  }
  if (rows === 0) {
    await logger.record({
      severity: "medium",
      category: "correctness",
      summary:
        "A linked device's People list is empty even though the person has granted someone -- there is not " +
        "even a per-person control to fall back on when the master toggle no-ops.",
      expected: "the person's peers listed on every linked device",
      actual: "0 peer rows",
      page: tablet.page,
    });
  }
});

// ---------------------------------------------------------------------------
// F1, other branch -- retiring a SPARE device must NOT revoke the person's
// sharing. Grants are per-person, so revoking here would silently cut off
// everyone the user's still-active phone is sharing with. This is the exact
// regression that "always revoke on backup-off" would have caused, and it is a
// branch of unlinkDevice() that the solo-device guard above never reaches.
// ---------------------------------------------------------------------------
const unlinkSpareKeepsSharing = guard("stats-sharing/unlink-spare-keeps-sharing", async ({ browser, logger, track }) => {
  const { alice, bob, alicePid } = await establishMutualSharing(browser, logger, { seed: 606 });
  track(alice); track(bob);

  const tablet = track(await makeDevice(browser, logger, "alice-tablet"));
  await linking.linkDevices(alice, tablet);
  const aliceUid = (await storage.readKey(alice.page, storage.KEYS.authUid)).raw;
  await linking.waitForLinkedUid(tablet.page, aliceUid, 15);
  await sharing.setMaster(tablet.page, true);

  // Retire the tablet. Alice's phone is still here, still backing up, still sharing.
  await linking.unlinkThisDevice(tablet.page);
  await tablet.page.waitForTimeout(config.syncSettleMs);

  if (!(await canReadDigest(bob, alicePid))) {
    await logger.record({
      severity: "high",
      category: "correctness",
      summary:
        "Unlinking a SPARE device revoked the person's sharing: Bob can no longer read Alice's digest even " +
        "though her phone is still linked, backing up and sharing. Grants are per-person, so a device leaving " +
        "a group that still has other devices must not revoke -- the user retired a tablet and their followers " +
        "silently lost access with nothing to explain it. unlinkDevice() should only revoke when it is the " +
        "person's LAST backing-up device (isLastBackupDevice). See CLOUD_SYNC_STRESS_2026-07-16.md F1.",
      expected: "retiring a spare device leaves the person's sharing intact",
      actual: "Bob's read of the digest is now denied",
      page: alice.page,
    });
  }
  const allowed = await emulator.dbGet(`statsProfiles/${alicePid}/allowed`);
  if (!allowed || !Object.keys(allowed).length) {
    await logger.record({
      severity: "high",
      category: "correctness",
      summary: "Unlinking a spare device wiped the person's allowed/ map, which belongs to the person, not the device.",
      expected: "allowed/ untouched when a non-last device unlinks",
      actual: JSON.stringify(allowed),
      page: alice.page,
    });
  }
  // And the phone must still describe itself honestly.
  const rowState = await sharing.displayRowState(alice.page);
  await sharing.closeSheet(alice.page);
  if (rowState !== "On") {
    await logger.record({
      severity: "medium",
      category: "correctness",
      summary: "The still-sharing phone reports Stats Sharing as Off after an unrelated device was retired.",
      expected: "On", actual: rowState, page: alice.page,
    });
  }
});

// ---------------------------------------------------------------------------
// F3 -- a follower must not be able to read the grant map or the owner's uid
// ---------------------------------------------------------------------------
const grantMapNotReadable = guard("stats-sharing/grant-map-not-readable-by-follower", async ({ browser, logger, track }) => {
  const { alice, bob, alicePid } = await establishMutualSharing(browser, logger, { seed: 7 });
  track(alice); track(bob);

  const allowedRead = await emulator.readAs(bob, `statsProfiles/${alicePid}/allowed`);
  if (allowedRead.ok) {
    await logger.record({
      severity: "medium",
      category: "privacy",
      summary:
        "A follower can read the owner's allowed/ map. The read rule is set at $profileId and cascades to every " +
        "child, so \"followers subscribe to the /digest child ONLY\" (index.html:2133) is a client-side " +
        "convention, not an enforced boundary. This breaks a user-facing promise, not just a code comment: the " +
        "sharing sheet says \"who else you played with stays private unless you say so below\" (4413). The pids " +
        "are opaque, but tournamentClaims/<code> maps profileId->name for any signed-in code-holder, so a " +
        "follower who has shared a session with someone can test whether the owner shares with them. " +
        "See CLOUD_SYNC_STRESS_2026-07-16.md F3.",
      expected: "PERMISSION_DENIED reading statsProfiles/<pid>/allowed",
      actual: "readable: " + JSON.stringify(allowedRead.val),
      page: bob.page,
    });
  }

  const rootRead = await emulator.readAs(bob, `statsProfiles/${alicePid}`);
  if (rootRead.ok && rootRead.val && rootRead.val.ownerUid) {
    await logger.record({
      severity: "low",
      category: "privacy",
      summary:
        "A follower can read the owner's profile root, which exposes their Firebase ownerUid. Not directly " +
        "exploitable (every uid-keyed path requires auth.uid === $uid or a personOf match) but it is a stable " +
        "cross-profile correlator followers shouldn't receive. Same cascade as above.",
      expected: "followers can read /digest only",
      actual: "ownerUid readable: " + rootRead.val.ownerUid,
      page: bob.page,
    });
  }
});

// ---------------------------------------------------------------------------
// F4 -- record ids must survive an archive burst without colliding
// ---------------------------------------------------------------------------
const idsSurviveBurst = guard("stats-sharing/record-ids-survive-archive-burst", async ({ browser, logger, track }) => {
  // Run the REAL generator, extracted from index.html at runtime rather than
  // transcribed, so this can't drift away from what the app actually does.
  // genRecordId composes genCode(), so the whole chain comes across -- including
  // a window shim pointing at Node's real WebCrypto, so the crypto branch of
  // genCode is the one actually measured rather than its Math.random fallback.
  const src = fs.readFileSync(path.join(config.repoRoot, "index.html"), "utf8");
  const grab = (re, what) => {
    const m = src.match(re);
    if (!m) throw new Error(`could not locate ${what} in index.html — this guard would silently stop testing anything`);
    return m[0];
  };
  let genRecordId;
  try {
    const parts = [
      "var window = { crypto: globalThis.crypto };",
      grab(/var CODE_CHARS = "[^"]+";/, "CODE_CHARS"),
      grab(/function genCode\(\) \{[\s\S]*?\n {2}\}/, "genCode"),
      grab(/function genRecordId\(\) \{[\s\S]*?\n {2}\}/, "genRecordId"),
      "return genRecordId;",
    ];
    // eslint-disable-next-line no-new-func
    genRecordId = new Function(parts.join("\n"))();
    if (typeof genRecordId() !== "string" && typeof genRecordId() !== "number") throw new Error("generator returned nothing usable");
  } catch (e) {
    await logger.record({
      severity: "medium", category: "test-coverage",
      summary: "Could not run the real genRecordId from index.html: " + e.message,
    });
    return;
  }

  // syncMyHistoryFromTourney() (index.html:1834) archives every newly-completed
  // match in one synchronous loop, so a device that was backgrounded while a
  // tournament progressed archives N records with an identical Date.now().
  const BURST = 8, TRIALS = 20000;
  let collisions = 0;
  for (let t = 0; t < TRIALS; t++) {
    const seen = new Set();
    for (let i = 0; i < BURST; i++) {
      const id = genRecordId();
      if (seen.has(id)) { collisions++; break; }
      seen.add(id);
    }
  }
  const rate = collisions / TRIALS;
  if (rate > 0.0001) {
    await logger.record({
      severity: "high",
      category: "correctness",
      summary:
        `genRecordId() collides on ${(rate * 100).toFixed(2)}% of ${BURST}-record archive bursts. The id must ` +
        "be globally unique -- it is the cloud storage key under users/<uid>/history/<id> AND half the " +
        "cross-device dedup key -- so a collision is silent data loss. Adding jitter to a timestamp " +
        "(Date.now() + random(1000)) does NOT widen the id space, it smears each id across a ~1s window, so " +
        "the two terms cancel instead of composing. Keep time and identity in separate parts of the string. " +
        "See CLOUD_SYNC_STRESS_2026-07-16.md F4.",
      expected: "collision rate ~0 across an archive burst",
      actual: `${collisions}/${TRIALS} bursts collided (${(rate * 100).toFixed(2)}%)`,
    });
  }

  // And the consequence, through the app's real code path. The fixture seeds two
  // records that already share an id -- the shape older builds could produce and
  // may still be sitting in real users' localStorage. genRecordId no longer
  // creates these, so this is a legacy-data guard.
  //
  // Note what is deliberately NOT asserted: that the CLOUD keeps both. The id is
  // the storage key under users/<uid>/history/<id>, so colliding records
  // overwrite each other there by construction. That is unreachable for records
  // archived by the fixed generator, and unrepairable for any legacy record it
  // already happened to -- re-keying history would resurrect every tombstoned
  // game (tombstones are keyed `matchUid || id`) and duplicate every synced copy.
  // Asserting it would demand a property we have chosen not to provide. The
  // local delete path below IS fixable, and is fixed.
  const COLLIDED = 1784000000500;
  const rec = (id, dateIso, teamA) => {
    const deals = [];
    let s0 = 0, s1 = 0;
    while (s0 < 50) { deals.push({ bid: 8, bidTeam: 0, bidderSeat: 0, pts: [10, 4] }); s0 += 10; s1 += 4; }
    return {
      id, date: dateIso, teams: [teamA, "Them"], players: ["Alice", "Bob", "Carol", "Dave"],
      dealerStart: 0, target: 50, totals: [s0, s1], winner: 0, deals, tournament: null,
    };
  };
  const seeded = [
    rec(COLLIDED, "2026-07-16T10:00:00.000Z", "Hawks"),
    rec(COLLIDED, "2026-07-16T11:00:00.000Z", "Eagles"),
    rec(COLLIDED + 12345, "2026-07-16T12:00:00.000Z", "Control"),
  ];
  const device = track(await makeDevice(browser, logger, "burst", async (context) => {
    await context.addInitScript((recs) => {
      localStorage.setItem("somerset:dev-history", JSON.stringify(recs));
      localStorage.setItem("somerset:dev-my-device-name", "Alice");
    }, seeded);
  }));

  await nav.goto(device.page, "History");
  await device.page.waitForTimeout(300);
  const first = device.page.locator(`.hist-entry[data-rec-id="${COLLIDED}"]`).first();
  await first.locator(".hist-item").click({ timeout: config.actionTimeoutMs });
  await device.page.waitForTimeout(120);
  await first.locator(".hist-del .link-btn.danger", { hasText: "Delete this game" }).click({ timeout: config.actionTimeoutMs });
  await device.page.waitForTimeout(400);
  const remaining = await device.page.evaluate(() =>
    JSON.parse(localStorage.getItem("somerset:dev-history") || "[]").map((r) => r.teams[0]));
  if (remaining.length !== seeded.length - 1) {
    await logger.record({
      severity: "high",
      category: "correctness",
      summary:
        "Deleting one game deletes two when ids collide: deleteHistoryRecordWithUndo() (index.html:6875) filters " +
        "on g.id !== rec.id, which matches both records, and Undo re-inserts only one. The user loses a game they " +
        "never chose to delete, permanently.",
      expected: `${seeded.length - 1} games left after deleting one`,
      actual: `${remaining.length} left: [${remaining.join(", ")}]`,
      page: device.page,
    });
  }
});

// ---------------------------------------------------------------------------
// F5 -- a digest that has stopped updating must not be labelled "shared live"
// ---------------------------------------------------------------------------
const staleDigestIsMarked = guard("stats-sharing/stale-digest-is-marked", async ({ browser, logger, track }) => {
  const { alice, bob, alicePid } = await establishMutualSharing(browser, logger, { seed: 11 });
  track(alice); track(bob);

  // The realistic staleness case, now that F1/F6 close the "revoked but still
  // readable" hole: Alice is still a fully authorized, actively-sharing
  // device -- she just hasn't recorded a game in a month. Grants stay
  // intact; only updatedAt ages. (Unlinking Alice here would instead trip
  // the F1 fix and revoke Bob's grant outright -- a different, already-
  // covered case, not this one.)
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  await fetch(
    `${config.emulator.databaseUrl}/statsProfiles/${alicePid}/digest/updatedAt.json` +
    `?ns=${config.emulator.namespace}&access_token=owner`,
    { method: "PUT", body: JSON.stringify(Date.now() - THIRTY_DAYS) });

  await bob.page.reload();
  await bob.page.waitForTimeout(2500);
  const stats = require("../lib/pageobjects/stats");
  await stats.openStatsBoard(bob.page);
  await stats.openPlayerDetail(bob.page, "Alice");
  const liveTitle = await bob.page.locator(".stats-section-title", { hasText: "Overall record — shared live" }).count();
  if (liveTitle > 0) {
    await logger.record({
      severity: "medium",
      category: "correctness",
      summary:
        "A digest whose updatedAt is 30 days old is still rendered under \"Overall record — shared live\", with " +
        "copy promising it is \"kept current as they play\" (index.html:6380). The follower gets no signal that " +
        "the record stopped updating and will silently drift from reality. The digest already carries updatedAt, " +
        "so the data needed to detect this is present and simply unused. See CLOUD_SYNC_STRESS_2026-07-16.md F5.",
      expected: "a staleness indication once the digest stops updating",
      actual: "section still titled \"Overall record — shared live\" with a 30-day-old digest",
      page: bob.page,
    });
  }
});

// ---------------------------------------------------------------------------
// F6 -- sharing must stay revocable after the profile's minting device unlinks
// ---------------------------------------------------------------------------
const revocableAfterOwnerUnlink = guard("stats-sharing/revocable-after-owner-unlink", async ({ browser, logger, track }) => {
  const { alice, bob, alicePid, bobPid } = await establishMutualSharing(browser, logger, { seed: 31 });
  track(alice); track(bob);

  const tablet = track(await makeDevice(browser, logger, "alice-tablet"));
  await linking.linkDevices(alice, tablet);
  const aliceUid = (await storage.readKey(alice.page, storage.KEYS.authUid)).raw;
  await linking.waitForLinkedUid(tablet.page, aliceUid, 15);
  await sharing.setMaster(tablet.page, true);

  const ownerUid = await emulator.dbGet(`statsProfiles/${alicePid}/ownerUid`);
  if (ownerUid !== aliceUid) {
    await logger.record({
      severity: "medium", category: "fixture",
      summary: "Fixture assumption broken: the phone was expected to own the profile",
      expected: aliceUid, actual: ownerUid,
    });
    return;
  }

  // The phone -- which minted the profile -- leaves.
  await linking.unlinkThisDevice(alice.page);
  await alice.page.waitForTimeout(config.syncSettleMs);

  // The tablet, still in the group and still sharing, tries to cut Bob off.
  await tablet.page.reload();
  await tablet.page.waitForTimeout(2500);
  await sharing.setMaster(tablet.page, false);
  await tablet.page.waitForTimeout(config.syncSettleMs);

  const stillReadable = await canReadDigest(bob, alicePid);
  const stamped = await emulator.dbGet(`statsProfiles/${alicePid}/personId`);
  // Order matters: this probe REVOKES, so sample stillReadable above it.
  // It separates the two independent reasons the revoke can fail -- "the rules
  // won't let any device write" (F6 proper) vs "the client never issued the
  // write" (F2's blind per-device peer roster). Without the split, F6's fix
  // looks like it did nothing.
  const probe = await emulator.writeAs(tablet, `statsProfiles/${alicePid}/allowed/${bobPid}`, null);

  if (!probe.ok) {
    await logger.record({
      severity: "high",
      category: "privacy",
      summary:
        "After the device that minted the statsProfile unlinks, the RULES lock the person's remaining devices " +
        "out of writing that profile -- including its allowed/ map -- so its grants cannot be revoked from any " +
        "device the person still uses (the ex-owner device retains write access via the unconditional ownerUid " +
        "clause, but its own UI reports sharing as off, and re-enabling sharing there re-grants every peer " +
        "before it could revoke them). " +
        "A non-owner authorizes via the profile's personId (root.child('personOf').child(auth.uid) === " +
        "data.child('personId')); if that is failing, either the profile was never stamped (see " +
        "stampProfilePersonId in index.html) or the rule regressed to chaining through personOf[ownerUid], " +
        "which unlinkDevice() deletes. See CLOUD_SYNC_STRESS_2026-07-16.md F6.",
      expected: "a remaining linked device's write to allowed/ is permitted",
      actual: `tablet's revoke write -> ${probe.code}; profile personId = ${JSON.stringify(stamped)}`,
      page: tablet.page,
    });
  } else if (stillReadable) {
    await logger.record({
      severity: "high",
      category: "privacy",
      summary:
        "Sharing is still unrevocable after the profile's minting device unlinked -- but NOT at the rules layer: " +
        "the remaining device's write to allowed/ is now permitted (F6's rules fix is working). The revoke never " +
        "happens because the client doesn't know there is anything to revoke: setStatsSharing(false) iterates " +
        "sharePeers, which restorePeersFromCloud (index.html:2272) only ever populates from users/<OWN uid>/" +
        "sharePeers. That is F2. F6's fix is inert until the peer roster is merged across linkedUids, exactly as " +
        "the interaction analysis in CLOUD_SYNC_STRESS_2026-07-16.md predicted.",
      expected: "master-off on a remaining device actually revokes the grant",
      actual: `tablet's revoke write -> ok (rules fixed), but master-off left the grant in place and Bob still reads the digest`,
      page: tablet.page,
    });
  }
});

// ---------------------------------------------------------------------------
// F7 -- a live digest identical to the follower's own History must not render
//        as a duplicate "Overall record" section
// ---------------------------------------------------------------------------
const matchingDigestIsHidden = guard("stats-sharing/matching-digest-is-hidden", async ({ browser, logger, track }) => {
  const { alice, bob, bobPid } = await establishMutualSharing(browser, logger, { seed: 51 });
  track(alice); track(bob);

  const stats = require("../lib/pageobjects/stats");
  const putDigestField = (field, value) => fetch(
    `${config.emulator.databaseUrl}/statsProfiles/${bobPid}/digest/${field}.json` +
    `?ns=${config.emulator.namespace}&access_token=owner`,
    { method: "PUT", body: JSON.stringify(value) });

  // Bob's published totals after the shared game. By construction these equal
  // what Alice's own History shows for him -- she archived that same one game --
  // so this is exactly the "no discrepancy" case the section must suppress.
  const base = await emulator.pollFor(async () => {
    const d = await emulator.dbGet(`statsProfiles/${bobPid}/digest`);
    return d && d.games != null ? d : null;
  });
  if (!base) {
    await logger.record({ severity: "high", category: "fixture",
      summary: "Baseline failed: Bob's digest never published", page: bob.page });
    return;
  }

  const liveSectionCount = async () => {
    await alice.page.reload();
    await alice.page.waitForTimeout(config.syncSettleMs);
    await stats.openStatsBoard(alice.page);
    await stats.openPlayerDetail(alice.page, "Bob");
    await alice.page.waitForTimeout(1200);
    return alice.page.locator(".stats-section-title", { hasText: "Overall record" }).count();
  };

  // Phase A -- push Bob's live record past Alice's local view. The section MUST
  // appear now; this doubles as proof that the digest actually reaches Alice's
  // device, so a Phase-B absence means suppression rather than a delivery race.
  await putDigestField("games", (base.games || 0) + 1);
  await putDigestField("wins", (base.wins || 0) + 1);
  const shownWhenDiverged = await emulator.pollFor(async () =>
    (await liveSectionCount()) > 0 ? true : null, 6, 500);
  if (!shownWhenDiverged) {
    await logger.record({ severity: "high", category: "fixture",
      summary: "Baseline failed: the Overall-record section never appeared even when Bob's live record diverged from Alice's History",
      page: alice.page });
    return;
  }

  // Phase B -- restore the digest to the values that match Alice's History. The
  // section must now be gone. Poll for absence so we don't assert mid-update.
  await putDigestField("games", base.games || 0);
  await putDigestField("wins", base.wins || 0);
  let stillShown = 1;
  for (let i = 0; i < 6 && stillShown > 0; i++) stillShown = await liveSectionCount();
  if (stillShown > 0) {
    await logger.record({
      severity: "low",
      category: "correctness",
      summary:
        "A followed peer's live digest whose wins/losses/games exactly match the follower's own History is still " +
        "rendered as a separate \"Overall record\" section, duplicating the numbers the rest of the stats page " +
        "already shows. renderStatsPlayer() gates the section on !digestMatchesLocal (index.html) -- if this " +
        "fires, that guard has regressed.",
      expected: "no separate Overall-record section when the live digest equals the local numbers",
      actual: "the Overall-record section is still shown despite an exact wins/losses/games match",
      page: alice.page,
    });
  }
});

module.exports = [
  backupOffStopsSharing,
  unlinkSpareKeepsSharing,
  linkedDeviceCanRevoke,
  grantMapNotReadable,
  idsSurviveBurst,
  staleDigestIsMarked,
  revocableAfterOwnerUnlink,
  matchingDigestIsHidden,
];

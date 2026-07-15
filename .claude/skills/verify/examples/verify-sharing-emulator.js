"use strict";
/**
 * E2E verification of the Stats Sharing feature against local Firebase
 * emulators (auth + database with the NEW rules from FIREBASE_SETUP.md).
 * Two isolated browser contexts = two people: Alice (host) and Bob (guest).
 *
 * Run from the repo root:  node /Users/kgcox/.claude/jobs/c43dd629/tmp/verify-sharing.js
 */
const REPO = process.cwd(); // run from repo root
const path = require("path");
const server = require(path.join(REPO, "stress-test/server.js"));
const seats = require(path.join(REPO, "stress-test/lib/pageobjects/seats.js"));
const sync = require(path.join(REPO, "stress-test/lib/pageobjects/sync.js"));
const nav = require(path.join(REPO, "stress-test/lib/pageobjects/nav.js"));
const newGame = require(path.join(REPO, "stress-test/lib/pageobjects/newGame.js"));
const stats = require(path.join(REPO, "stress-test/lib/pageobjects/stats.js"));
const linking = require(path.join(REPO, "stress-test/lib/pageobjects/linking.js"));
const tSetup = require(path.join(REPO, "stress-test/lib/pageobjects/tournamentSetup.js"));
const simulator = require(path.join(REPO, "stress-test/lib/simulator.js"));
const playwright = require(path.join(REPO, "node_modules/playwright"));

const APP_URL = "http://127.0.0.1:8934/index.html";
const results = [];
let failures = 0;
function check(label, ok, detail) {
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  [" + detail + "]" : ""}`);
  if (!ok) failures++;
  console.log(results[results.length - 1]);
}

async function makeDevice(browser, label) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try { if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error("disabled")); } catch (e) {}
  });
  // Rewire the app at the door: emulator database URL + project, and hook the
  // auth emulator immediately after the config block (before the app script).
  await context.route("**/index.html", async (route) => {
    const resp = await route.fetch();
    let html = await resp.text();
    html = html.replace(
      'databaseURL: "https://somerset-scorepad-default-rtdb.firebaseio.com",',
      'databaseURL: "http://127.0.0.1:9000?ns=demo-somerset-default-rtdb",');
    html = html.replace('projectId: "somerset-scorepad",', 'projectId: "demo-somerset",');
    html = html.replace(
      'measurementId: "G-0WFPCHTJBJ"\n};',
      'measurementId: "G-0WFPCHTJBJ"\n};\nfirebase.initializeApp(window.SOMERSET_FB_CONFIG);\nfirebase.auth().useEmulator("http://127.0.0.1:9099");');
    await route.fulfill({ response: resp, body: html });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] console.error: ${m.text()}`); });
  await page.goto(APP_URL);
  await page.waitForTimeout(800);
  return { context, page, errors, label };
}

async function enableBackup(page) {
  // turnOnBackup() no-ops with a "Couldn't connect" toast until anonymous
  // auth has resolved — wait for the app to record its uid first.
  await pollFor(() => readLS(page, "somerset:dev-auth-uid"), 20, 500);
  await linking.openDisplaySheet(page);
  await linking.cloudBackupToggle(page).click();
  const on = await pollFor(async () =>
    (await linking.cloudBackupToggle(page).getAttribute("class")).includes(" on"), 8, 500);
  return !!on;
}

async function openSharingSheet(page) {
  await linking.displaySheet(page).locator(".settings-row-label", { hasText: "Stats Sharing" }).click();
  await page.waitForTimeout(150);
  return page.locator('[role="dialog"][aria-label="Stats sharing"]');
}

function masterToggle(page) {
  return page.locator('[role="dialog"][aria-label="Stats sharing"] [aria-label="Share stats with people I play"]');
}

async function closeSheet(page) {
  const btn = page.locator('[role="dialog"] .sheet-btn.ghost', { hasText: "Done" }).first();
  if (await btn.count()) await btn.click();
  await page.waitForTimeout(150);
}

async function readLS(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

async function pollFor(fn, attempts = 15, delay = 1000) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, delay));
  }
  return last;
}

(async () => {
  const httpServer = await server.start();
  const browser = await playwright.chromium.launch({ headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
  const shots = "/tmp/somerset-verify-shots";
  require("fs").mkdirSync(shots, { recursive: true });
  const fakeLogger = { step() {}, async record(f) { check(`simulator finding: ${f.summary}`, false); } };

  const alice = await makeDevice(browser, "alice");
  const bob = await makeDevice(browser, "bob");
  try {
    // ---- Alice: backup on, sharing on ----
    check("Alice: cloud backup toggles on", await enableBackup(alice.page));
    let sheet = await openSharingSheet(alice.page);
    check("Alice: sharing sheet opens with master toggle", (await masterToggle(alice.page).count()) === 1);
    await masterToggle(alice.page).click();
    await alice.page.waitForTimeout(1500);
    check("Alice: master toggle flips on", (await masterToggle(alice.page).getAttribute("aria-checked")) === "true");
    const aliceProfile = await readLS(alice.page, "somerset:dev-profile-id");
    check("Alice: profileId minted", !!aliceProfile && aliceProfile.startsWith("sp") && aliceProfile.length === 14, aliceProfile);
    await alice.page.screenshot({ path: shots + "/01-alice-sharing-sheet.png" });
    await closeSheet(alice.page);
    await closeSheet(alice.page); // display sheet underneath? (sharing sheet replaced it; second close is a no-op)

    // ---- Bob: backup on, sharing on ----
    check("Bob: cloud backup toggles on", await enableBackup(bob.page));
    await openSharingSheet(bob.page);
    await masterToggle(bob.page).click();
    await bob.page.waitForTimeout(1500);
    check("Bob: master toggle flips on", (await masterToggle(bob.page).getAttribute("aria-checked")) === "true");
    const bobProfile = await readLS(bob.page, "somerset:dev-profile-id");
    check("Bob: profileId minted", !!bobProfile && bobProfile !== aliceProfile, bobProfile);
    await closeSheet(bob.page);

    // ---- Shared game: Alice hosts, Bob joins; both identify ----
    await seats.nameAllSeats(alice.page, ["Alice", "Bob", "Carol", "Dave"]);
    await sync.shareFromGameOptions(alice.page);
    const code = await sync.readJoinCode(alice.page);
    check("Alice: got join code", !!code && code.length === 6, code);
    await sync.identifyFromShareSheet(alice.page, "Alice");

    await nav.goto(bob.page, "Tournament");
    await tSetup.openJoinSheet(bob.page);
    await sync.joinWithCode(bob.page, code);
    const joinErr = await sync.joinErrorText(bob.page);
    check("Bob: joined session", !joinErr, joinErr || "");
    await bob.page.waitForTimeout(400);
    if ((await bob.page.locator('[role="dialog"][aria-label="Identify yourself"]').count()) > 0) {
      await sync.chooseIdentity(bob.page, "Bob");
    }

    // Claims should now exist for both names in the emulator.
    const claims = await pollFor(async () => {
      const res = await fetch("http://127.0.0.1:9000/tournamentClaims/" + code + ".json?ns=demo-somerset-default-rtdb&access_token=owner");
      const val = await res.json();
      return val && Object.keys(val).length >= 2 ? val : null;
    }, 10);
    check("Both claims visible in DB", !!claims, JSON.stringify(claims));

    // ---- Play the shared game to completion on Alice ----
    await simulator.playDealsToCompletion(alice.page, { bidderFor: simulator.namedBidderFor, seed: 4242, logger: fakeLogger, contextLabel: "alice" });
    await newGame.continueSharedGame(alice.page);
    await newGame.dismissPlayAgainOffer(alice.page);

    // ---- Auto-follow: each device's peer list should now show the other ----
    const alicePeers = await pollFor(async () => {
      const raw = await readLS(alice.page, "somerset:dev-share-peers");
      const peers = raw ? JSON.parse(raw) : {};
      return peers[bobProfile] ? peers : null;
    });
    check("Alice auto-followed Bob (peer row exists)", !!alicePeers, alicePeers && JSON.stringify(alicePeers[bobProfile]));
    const bobPeers = await pollFor(async () => {
      const raw = await readLS(bob.page, "somerset:dev-share-peers");
      const peers = raw ? JSON.parse(raw) : {};
      return peers[aliceProfile] ? peers : null;
    });
    check("Bob auto-followed Alice (peer row exists)", !!bobPeers, bobPeers && JSON.stringify(bobPeers[aliceProfile]));

    // Grants should be mutual in the DB.
    const aliceAllowed = await pollFor(async () => {
      const res = await fetch(`http://127.0.0.1:9000/statsProfiles/${aliceProfile}/allowed.json?ns=demo-somerset-default-rtdb&access_token=owner`);
      return await res.json();
    }, 8);
    check("Alice granted Bob in allowed/", !!(aliceAllowed && aliceAllowed[bobProfile]), JSON.stringify(aliceAllowed));

    // ---- Alice's Stats detail for Bob shows his live digest ----
    await stats.openStatsBoard(alice.page);
    await stats.openPlayerDetail(alice.page, "Bob");
    const overall = await pollFor(async () => {
      await alice.page.reload(); // exercise the boot re-attach path too
      await alice.page.waitForTimeout(1200);
      await stats.openStatsBoard(alice.page);
      await stats.openPlayerDetail(alice.page, "Bob");
      const sec = alice.page.locator(".stats-section-title", { hasText: "Overall record — shared live" });
      if ((await sec.count()) === 0) return null;
      const row = alice.page.locator(".stats-pair-row", { hasText: "Record" }).first();
      return (await row.count()) ? (await row.textContent()).trim() : null;
    }, 8, 1500);
    check("Alice sees Bob's live overall record", !!overall && /Record/.test(overall), overall);
    await alice.page.screenshot({ path: shots + "/02-alice-sees-bob-digest.png", fullPage: true });

    // ---- Recent-games feed: rows visible, names ABSENT by default ----
    const recentRows = await pollFor(async () => {
      const title = alice.page.locator(".stats-section-title", { hasText: "Their recent games" });
      if ((await title.count()) === 0) return null;
      const rows = alice.page.locator(".stats-section:has(.stats-section-title:text('Their recent games')) .stats-pair-row");
      return (await rows.count()) ? await rows.allTextContents() : null;
    }, 8, 1000);
    check("Alice sees Bob's recent-games feed", !!recentRows && recentRows.length >= 1, recentRows && recentRows[0]);
    const digestNow = await (await fetch(`http://127.0.0.1:9000/statsProfiles/${bobProfile}/digest.json?ns=demo-somerset-default-rtdb&access_token=owner`)).json();
    const namesAbsent = digestNow && digestNow.recentGames && digestNow.recentGames.every((g) => !g.partner && !g.opponents);
    check("Names absent from published games by default", !!namesAbsent, JSON.stringify(digestNow && digestNow.recentGames && digestNow.recentGames[0]));

    // ---- Bob opts into names; Alice's rows gain "vs ..." ----
    await linking.openDisplaySheet(bob.page);
    await openSharingSheet(bob.page);
    await bob.page.locator('[aria-label="Include names in shared games"]').click();
    await bob.page.waitForTimeout(300);
    check("Bob: names toggle flips on",
      (await bob.page.locator('[aria-label="Include names in shared games"]').getAttribute("aria-checked")) === "true");
    await closeSheet(bob.page);
    const namedRow = await pollFor(async () => {
      await stats.openStatsBoard(alice.page);
      await stats.openPlayerDetail(alice.page, "Bob");
      const rows = alice.page.locator(".stats-section:has(.stats-section-title:text('Their recent games')) .stats-pair-row");
      const texts = (await rows.count()) ? await rows.allTextContents() : [];
      return texts.find((t) => /vs /.test(t)) || null;
    }, 10, 1000);
    check("Alice sees opponent names after Bob opts in", !!namedRow, namedRow);

    // ---- Highlights link: "Longest game" opens the game-detail sheet ----
    await stats.openStatsBoard(alice.page);
    await stats.openPlayerDetail(alice.page, "Alice");
    const lgRow = alice.page.locator(".stats-pair-row", { hasText: "Longest game" });
    check("Alice: Longest game highlight row exists", (await lgRow.count()) === 1);
    await lgRow.click();
    await alice.page.waitForTimeout(300);
    const detailOpen = (await alice.page.locator('[role="dialog"][aria-label="Game detail"]').count()) > 0;
    check("Highlight link opens the game-detail sheet", detailOpen);
    if (detailOpen) {
      await alice.page.locator('[role="dialog"][aria-label="Game detail"] .sheet-btn.ghost').click().catch(() => {});
      await alice.page.waitForTimeout(200);
    }

    // ---- Revocation: Bob cuts Alice off; Alice's view flips to denied ----
    await linking.openDisplaySheet(bob.page);
    await openSharingSheet(bob.page);
    const bobPeerToggle = bob.page.locator('[aria-label="Share my stats with Alice"]');
    check("Bob: per-person toggle for Alice exists and is on", (await bobPeerToggle.getAttribute("aria-checked")) === "true");
    await bob.page.screenshot({ path: shots + "/03-bob-people-list.png" });
    await bobPeerToggle.click();
    await bob.page.waitForTimeout(800);
    check("Bob: per-person toggle now off", (await bobPeerToggle.getAttribute("aria-checked")) === "false");
    await closeSheet(bob.page);

    const denied = await pollFor(async () => {
      await stats.openStatsBoard(alice.page);
      await stats.openPlayerDetail(alice.page, "Bob");
      const t = alice.page.locator(".peer-sub", { hasText: "isn't sharing their stats with you" });
      return (await t.count()) > 0;
    }, 12, 1000);
    check("Alice sees revoked state after Bob's toggle-off", denied);
    await alice.page.screenshot({ path: shots + "/04-alice-sees-revoked.png", fullPage: true });

    // ---- Unfollow / follow-again on the detail page ----
    await alice.page.locator(".peer-follow-btn", { hasText: "Unfollow Bob" }).click();
    await alice.page.waitForTimeout(300);
    const unfollowed = (await alice.page.locator(".peer-sub", { hasText: "You unfollowed Bob" }).count()) > 0;
    check("Alice: unfollow flips detail section", unfollowed);
    await alice.page.locator(".peer-follow-btn", { hasText: "Follow again" }).click();
    await alice.page.waitForTimeout(800);
    const followedAgain = (await alice.page.locator(".stats-section-title", { hasText: "Overall record" }).count()) > 0;
    check("Alice: follow-again restores section", followedAgain);

    // ---- Probe: stranger (no grant) cannot read a digest directly ----
    const strangerRead = await bob.page.evaluate(async (pid) => {
      try {
        // Bob IS granted on Alice's profile; probe a nonexistent profile instead
        const snap = await firebase.database().ref("statsProfiles/spFAKEFAKE0000/digest").once("value");
        return "read-ok:" + JSON.stringify(snap.val());
      } catch (e) { return "denied:" + (e.code || e.message); }
    }, aliceProfile);
    check("Probe: reading an unshared/nonexistent profile is denied", strangerRead.startsWith("denied"), strangerRead);

    // ---- Probe: Bob cannot claim a profileId he doesn't own ----
    const forgedClaim = await bob.page.evaluate(async (args) => {
      try {
        await firebase.database().ref("tournamentClaims/" + args.code + "/forged").set({ profileId: args.alicePid, name: "Mallory" });
        return "write-ok";
      } catch (e) { return "denied:" + (e.code || e.message); }
    }, { code, alicePid: aliceProfile });
    check("Probe: claiming someone else's profileId is denied by rules", forgedClaim.startsWith("denied"), forgedClaim);

    // ---- Probe: Bob cannot write into Alice's profile (grant himself back) ----
    const forgedGrant = await bob.page.evaluate(async (args) => {
      try {
        await firebase.database().ref("statsProfiles/" + args.alicePid + "/allowed/" + args.bobPid).set(true);
        return "write-ok";
      } catch (e) { return "denied:" + (e.code || e.message); }
    }, { alicePid: aliceProfile, bobPid: bobProfile });
    check("Probe: granting yourself on someone else's profile is denied", forgedGrant.startsWith("denied"), forgedGrant);

    // ---- Console/page errors across the whole run ----
    const allErrors = alice.errors.concat(bob.errors)
      .filter((e) => !/PERMISSION_DENIED|permission_denied/i.test(e)) // expected denials from probes above
      .filter((e) => !/404 \(Not Found\)/.test(e)); // /_vercel/* analytics scripts, absent on the local static server (pre-existing)
    check("No unexpected console/page errors", allErrors.length === 0, allErrors.slice(0, 5).join(" | "));
  } catch (e) {
    check("scenario crashed: " + e.message, false, e.stack && e.stack.split("\n")[1]);
    await alice.page.screenshot({ path: shots + "/99-crash-alice.png", fullPage: true }).catch(() => {});
    await bob.page.screenshot({ path: shots + "/99-crash-bob.png", fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
    httpServer.close();
    console.log("\n==== SUMMARY ====");
    results.forEach((r) => console.log(r));
    process.exit(failures ? 1 : 0);
  }
})();

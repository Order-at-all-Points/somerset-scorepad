"use strict";
/**
 * Local Firebase emulator support for the "sharing" phase.
 *
 * Why this phase can't run against production like the others do:
 *  - its assertions need ground-truth reads of statsProfiles/allowed via the
 *    emulator's ?access_token=owner backdoor, which production has no
 *    equivalent for (the whole point is that the app CAN'T read those paths);
 *  - the scenarios deliberately drive revocation failures, which against
 *    production would leave real, permanently-unrevocable grants on real
 *    profiles (see CLOUD_SYNC_STRESS_2026-07-16.md, F6);
 *  - it resets the whole database between scenarios.
 *
 * Setup (see .claude/skills/verify/SKILL.md for the full recipe):
 *   JDK 21+, then in a scratch dir with a package.json:
 *     npm i firebase-tools
 *     ./node_modules/.bin/firebase emulators:start --only database,auth --project demo-somerset
 *   with database.rules.json extracted from FIREBASE_SETUP.md's json fence.
 */
const config = require("../config");

const E = config.emulator;
const NS_Q = `ns=${E.namespace}&access_token=owner`;

/** True if the database emulator is reachable. Cheap; used to skip the phase. */
async function isUp() {
  try {
    const res = await fetch(`${E.databaseUrl}/.json?${NS_Q}`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/** Ground-truth read, bypassing rules. Never use this to prove ACCESS -- only
 *  to inspect what is actually stored. Use readAs() for access claims. */
async function dbGet(p) {
  const res = await fetch(`${E.databaseUrl}/${p}.json?${NS_Q}`);
  return res.json();
}

async function dbReset() {
  await fetch(`${E.databaseUrl}/.json?${NS_Q}`, { method: "DELETE" });
}

/**
 * Rewire the app at the door: point it at the emulators and hook the auth
 * emulator immediately after the config literal, before the app script runs
 * (the app's own initAuth/initFb then skip re-init). Three string swaps against
 * index.html -- if any stops matching, the device would silently talk to
 * PRODUCTION, so each is verified and throws loudly instead.
 */
async function wireToEmulators(context) {
  await context.route("**/index.html", async (route) => {
    const resp = await route.fetch();
    const html = await resp.text();
    const swaps = [
      ['databaseURL: "https://somerset-scorepad-default-rtdb.firebaseio.com",',
        `databaseURL: "${E.databaseUrl}?ns=${E.namespace}",`],
      ['projectId: "somerset-scorepad",', `projectId: "${E.projectId}",`],
      ['measurementId: "G-0WFPCHTJBJ"\n};',
        'measurementId: "G-0WFPCHTJBJ"\n};\nfirebase.initializeApp(window.SOMERSET_FB_CONFIG);\n' +
        `firebase.auth().useEmulator("${E.authUrl}");`],
    ];
    let out = html;
    for (const [from, to] of swaps) {
      if (out.indexOf(from) === -1) {
        throw new Error(
          "emulator rewiring failed: index.html no longer contains " + JSON.stringify(from.slice(0, 40)) +
          " -- refusing to run, the device would hit PRODUCTION Firebase");
      }
      out = out.split(from).join(to);
    }
    await route.fulfill({ response: resp, body: out });
  });
}

/**
 * A rules-enforced read from `device`'s own authenticated session. This is the
 * only honest proof of what a device can or cannot actually see -- dbGet()
 * bypasses rules and proves nothing about access.
 * Returns { ok:true, val } or { ok:false, code }.
 */
async function readAs(device, dbPath) {
  return device.page.evaluate(async (p) => {
    try {
      const snap = await firebase.database().ref(p).once("value");
      return { ok: true, val: snap.val() };
    } catch (e) {
      return { ok: false, code: e.code || e.message };
    }
  }, dbPath);
}

/** A rules-enforced write probe from `device`'s own session. */
async function writeAs(device, dbPath, value) {
  return device.page.evaluate(async (a) => {
    try {
      if (a.value === null) await firebase.database().ref(a.p).remove();
      else await firebase.database().ref(a.p).set(a.value);
      return { ok: true };
    } catch (e) {
      return { ok: false, code: e.code || e.message };
    }
  }, { p: dbPath, value: value === undefined ? true : value });
}

/** Poll until `fn` returns something truthy, or give up. */
async function pollFor(fn, attempts = 12, delay = 1000) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, delay));
  }
  return last;
}

module.exports = { isUp, dbGet, dbReset, wireToEmulators, readAs, writeAs, pollFor };

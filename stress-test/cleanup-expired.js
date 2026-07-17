#!/usr/bin/env node
"use strict";
/**
 * Sweep PRODUCTION for tournaments/linkCodes that are already dead by the
 * app's own security rules (past their 48h / 30min expiry window, or in
 * tournaments' case missing `_createdAt` entirely -- the pre-fix Rematch/
 * Redraw bug that bricked sync, see FIREBASE_SETUP.md's rules and
 * memory/firebase-sync-open-issues.md). Expired records are already
 * unreadable and unwritable by rules; this only reclaims the storage they
 * still occupy. It never touches users/, people/, personOf/, profileOf/, or
 * statsProfiles/ -- those hold real backup/identity/sharing data with no
 * built-in expiry, and determining true orphans there needs cross-
 * referencing against Firebase Auth (see audit-orphaned-profiles.js for the
 * one case -- stranded statsProfiles grants -- that already has a read-only
 * checker).
 *
 * Why this exists: `stress-test/config.js`'s sync scenarios used to run
 * against this same production project (fixed 2026-07-17 -- every device now
 * wires to the local emulators by default, see lib/browser.js), so
 * production accumulated ~780 stress-test tournaments and dozens of expired
 * linkCodes with no code anywhere to clean them up. Even with that source
 * plugged, RTDB has no native TTL -- real usage's own expired
 * tournaments/linkCodes will keep piling up forever unless something sweeps
 * them, so this is meant to be re-run periodically (e.g. before each
 * release), not just once.
 *
 * READ-ONLY by default -- prints what it would delete. Pass --apply to
 * actually delete.
 *
 * Usage:  firebase login          (interactive, once)
 *         node stress-test/cleanup-expired.js [--project somerset-scorepad] [--apply]
 */
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const projIdx = args.indexOf("--project");
const PROJECT = projIdx !== -1 ? args[projIdx + 1] : "somerset-scorepad";
const APPLY = args.includes("--apply");
const FIREBASE = process.env.FIREBASE_BIN || "firebase";

const TOURNAMENT_TTL_MS = 172800000; // 48h, matches tournaments/$code rules
const LINKCODE_TTL_MS = 1800000; // 30min, matches linkCodes/$code rules

function fb(dbPath, extra = []) {
  const out = execFileSync(FIREBASE,
    ["database:get", dbPath, "--project", PROJECT, ...extra],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out || "null");
}

function fbUpdate(patch) {
  execFileSync(FIREBASE,
    ["database:update", "/", "-d", JSON.stringify(patch), "--project", PROJECT, "-f"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function main() {
  try {
    execFileSync(FIREBASE, ["projects:list"], { stdio: "pipe" });
  } catch (e) {
    console.error("Not authenticated to Firebase. Run:  firebase login\n");
    process.exit(2);
  }

  console.log(`Scanning project ${PROJECT} for expired tournaments/linkCodes${APPLY ? "" : " (dry run -- pass --apply to delete)"}...\n`);

  const now = Date.now();
  const patch = {};

  const tournaments = fb("/tournaments") || {};
  let tExpired = 0, tNoStamp = 0, tActive = 0;
  for (const [code, t] of Object.entries(tournaments)) {
    if (!t || typeof t !== "object" || !t._createdAt) {
      patch[`/tournaments/${code}`] = null;
      tNoStamp++;
    } else if (now - t._createdAt > TOURNAMENT_TTL_MS) {
      patch[`/tournaments/${code}`] = null;
      tExpired++;
    } else {
      tActive++;
    }
  }
  console.log(`tournaments: ${Object.keys(tournaments).length} total -- ${tExpired} expired, ${tNoStamp} missing _createdAt, ${tActive} still active (kept)`);

  const linkCodes = fb("/linkCodes") || {};
  let lExpired = 0, lActive = 0;
  for (const [code, l] of Object.entries(linkCodes)) {
    if (!l || typeof l !== "object" || !l.createdAt || now - l.createdAt > LINKCODE_TTL_MS) {
      patch[`/linkCodes/${code}`] = null;
      lExpired++;
    } else {
      lActive++;
    }
  }
  console.log(`linkCodes: ${Object.keys(linkCodes).length} total -- ${lExpired} expired (kept ${lActive} still within their 30min window)`);

  // tournamentClaims share a tournament's own 48h expiry -- sweep any whose
  // parent code is gone or itself expired.
  const claims = fb("/tournamentClaims") || {};
  let cExpired = 0, cActive = 0;
  for (const code of Object.keys(claims)) {
    const t = tournaments[code];
    if (!t || !t._createdAt || now - t._createdAt > TOURNAMENT_TTL_MS) {
      patch[`/tournamentClaims/${code}`] = null;
      cExpired++;
    } else {
      cActive++;
    }
  }
  if (cExpired || cActive) {
    console.log(`tournamentClaims: ${Object.keys(claims).length} code(s) with claims -- ${cExpired} tied to an expired/gone tournament, ${cActive} kept`);
  }

  const totalDeletes = Object.keys(patch).length;
  console.log(`\n${totalDeletes} record(s) ${APPLY ? "to delete" : "would be deleted"}.`);

  if (!totalDeletes) {
    console.log("Nothing to clean up.");
    return;
  }

  if (!APPLY) {
    console.log("Dry run only -- re-run with --apply to actually delete.");
    return;
  }

  fbUpdate(patch);
  console.log("Deleted.");
}

main();

#!/usr/bin/env node
"use strict";
/**
 * Audit PRODUCTION for statsProfiles whose grants the person can no longer revoke.
 *
 * Why this exists: before the 2026-07-17 fix, statsProfiles authorized a
 * non-owner device via `personOf[auth.uid] === personOf[ownerUid]`. unlinkDevice()
 * deletes personOf/<ownerUid>, so once the device that MINTED a profile unlinked,
 * the person's OTHER devices could no longer write that profile -- including
 * removing an allowed/ entry. Sharing became unrevocable from every device the
 * person still uses, and the digest (plus its full hand-by-hand highlight games)
 * stayed readable by every grantee. See CLOUD_SYNC_STRESS_2026-07-16.md F6.
 *
 * The fix authorizes via the profile's own `personId`, stamped by the client. It
 * does NOT repair profiles orphaned beforehand: they have no personId and their
 * owner's personOf is already gone, so nothing the client does reaches them.
 *
 * Precision matters here, in both directions:
 *  - The `ownerUid` clause is UNCONDITIONAL, so the ex-owner device itself can
 *    still write. A profile is only truly beyond reach if that device is gone
 *    (wiped/reinstalled/given away -- often the very reason someone unlinks).
 *    Server data cannot tell us whether it still exists, so this reports what is
 *    knowable: which of the person's CURRENT devices are locked out.
 *  - A solo sharer who never linked looks identical to an orphan by
 *    personId/personOf alone (both null) but is perfectly healthy -- their own
 *    device owns the profile. Classifying on that alone would flag every solo
 *    user. The real signal is a STRANDED SIBLING: a uid whose profileOf points at
 *    this profile, which is not the owner, and which cannot write it.
 *
 * READ-ONLY. It never writes. Remediation is a deliberate product decision --
 * removing allowed/ entries silently changes what real followers can see.
 *
 * Usage:  firebase login          (interactive, once)
 *         node stress-test/audit-orphaned-profiles.js [--project somerset-scorepad]
 *
 * Reads only the fields it needs (ownerUid / personId / allowed keys) rather than
 * dumping every digest -- those contain real users' game records.
 */
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const projIdx = args.indexOf("--project");
const PROJECT = projIdx !== -1 ? args[projIdx + 1] : "somerset-scorepad";
const FIREBASE = process.env.FIREBASE_BIN || "firebase";

function fb(dbPath, extra = []) {
  const out = execFileSync(FIREBASE,
    ["database:get", dbPath, "--project", PROJECT, ...extra],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out || "null");
}

function main() {
  try {
    execFileSync(FIREBASE, ["projects:list"], { stdio: "pipe" });
  } catch (e) {
    console.error("Not authenticated to Firebase. Run:  firebase login\n");
    process.exit(2);
  }

  console.log(`Auditing project ${PROJECT} for unrevocable statsProfiles...\n`);

  const pids = Object.keys(fb("/statsProfiles", ["--shallow"]) || {});
  const personOf = fb("/personOf") || {};   // uid -> personId  (current group membership)
  const profileOf = fb("/profileOf") || {}; // uid -> profileId (which devices belong to a profile)
  console.log(`  ${pids.length} profile(s), ${Object.keys(personOf).length} personOf, ${Object.keys(profileOf).length} profileOf\n`);

  // Which uids claim each profile as theirs.
  const devicesOf = {};
  for (const uid of Object.keys(profileOf)) {
    const pid = profileOf[uid];
    (devicesOf[pid] = devicesOf[pid] || []).push(uid);
  }

  const stranded = [], recovered = [], healthy = [];
  for (const pid of pids) {
    const ownerUid = fb(`/statsProfiles/${pid}/ownerUid`);
    const personId = fb(`/statsProfiles/${pid}/personId`);
    const grants = Object.keys(fb(`/statsProfiles/${pid}/allowed`, ["--shallow"]) || {}).length;
    if (!grants) continue;   // nothing granted -> nothing at risk

    const canWrite = (uid) =>
      uid === ownerUid ||
      (personId != null && personOf[uid] != null && personOf[uid] === personId);

    const devices = devicesOf[pid] || [];
    const siblings = devices.filter((u) => u !== ownerUid);
    const lockedOut = siblings.filter((u) => !canWrite(u));
    const ownerLeftGroup = ownerUid != null && personOf[ownerUid] == null;

    const row = { pid, ownerUid, personId, grants, devices: devices.length, lockedOut: lockedOut.length };
    if (lockedOut.length && ownerLeftGroup) stranded.push(row);
    else if (personId != null && siblings.some(canWrite)) recovered.push(row);
    else healthy.push(row);
  }

  const show = (title, rows, note) => {
    console.log(`${title}: ${rows.length}${note ? "  — " + note : ""}`);
    for (const r of rows) {
      console.log(`   ${r.pid}  grants=${r.grants}  devices=${r.devices}  lockedOut=${r.lockedOut}  ` +
        `personId=${r.personId === null ? "(unstamped)" : r.personId}`);
    }
    console.log("");
  };

  show("HEALTHY", healthy, "owner reachable, or solo — revocable");
  show("RECOVERED", recovered, "personId stamped; the person's devices can revoke");
  show("*** STRANDED ***", stranded, "owner left the group and siblings are locked out");

  if (stranded.length) {
    const totalGrants = stranded.reduce((n, r) => n + r.grants, 0);
    console.log(`${stranded.length} profile(s), ${totalGrants} grant(s): the person's remaining devices CANNOT revoke.`);
    console.log("Only the ex-owner device could, and only by re-enabling backup+sharing first (which re-grants");
    console.log("everyone before it could revoke) — so in practice these are unrevocable, and truly permanent if");
    console.log("that device is gone. Each is a real person whose stats and highlight games stay readable.");
    console.log("");
    console.log("Remediation options (none applied — this script never writes):");
    console.log("  (a) admin-stamp personId from a stranded sibling's personOf  -> hands control back to the");
    console.log("      person's own devices; least destructive, nothing changes for followers until the user acts.");
    console.log("  (b) admin-remove the allowed/ entries                         -> hard revoke; followers silently");
    console.log("      lose access to someone they were legitimately following.");
    console.log("  (c) leave as-is and notify.");
    console.log("Option (a) is the closest to what the user would have gotten had the bug never existed.");
  } else {
    console.log("No stranded profiles found.");
  }
}

main();

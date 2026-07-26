#!/usr/bin/env node
"use strict";
/**
 * READ-ONLY. Scopes the blast radius of the F2 fix (adoptPersonProfile) against
 * PRODUCTION before it ships.
 *
 * The fix reconciles a person who owns more than one statsProfile onto the oldest
 * one: it migrates the retiring profile's allowed/ grants across, re-points the
 * device, and DELETES the stray. That is a real mutation of real users' data, so
 * this reports how many people it would touch and exactly what it would do to each
 * — before anyone runs it.
 *
 * Reads only ownerUid / personId / createdAt / allowed KEYS. Never digests (real
 * game records), never writes.
 */
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const projIdx = args.indexOf("--project");
const PROJECT = projIdx !== -1 ? args[projIdx + 1] : "somerset-scorepad";
const FIREBASE = process.env.FIREBASE_BIN || "firebase";

function fb(dbPath, extra = []) {
  const out = execFileSync(FIREBASE, ["database:get", dbPath, "--project", PROJECT, ...extra], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out || "null");
}

function main() {
  console.log(`Scoping F2 reconcile against ${PROJECT} (read-only)\n`);

  const personOf = fb("/personOf") || {};    // uid -> personId
  const profileOf = fb("/profileOf") || {};  // uid -> profileId
  const pids = Object.keys(fb("/statsProfiles", ["--shallow"]) || {});

  // Group each person's devices, and the distinct profiles those devices claim.
  const byPerson = {};
  for (const uid of Object.keys(profileOf)) {
    const person = personOf[uid];
    if (person == null) continue;            // solo device, not in any group
    const b = (byPerson[person] = byPerson[person] || { uids: [], pids: {} });
    b.uids.push(uid);
    b.pids[profileOf[uid]] = true;
  }

  const persons = Object.keys(byPerson);
  const split = persons.filter((p) => Object.keys(byPerson[p].pids).length > 1);

  console.log(`  ${pids.length} profiles, ${Object.keys(personOf).length} personOf, ${Object.keys(profileOf).length} profileOf`);
  console.log(`  ${persons.length} person(s) have at least one device with a profile`);
  console.log(`  ${split.length} person(s) are SPLIT across more than one profile\n`);

  if (!split.length) {
    console.log("No split persons. The F2 reconcile would be a no-op against current production data:");
    console.log("it only acts when a person's devices point at more than one profile.");
    console.log("\nProfiles per person:");
    for (const p of persons) {
      console.log(`   ${p}  devices=${byPerson[p].uids.length}  profiles=${Object.keys(byPerson[p].pids).length}`);
    }
    return;
  }

  console.log("Each of these would be reconciled onto its OLDEST profile on next launch:\n");
  for (const person of split) {
    const entry = byPerson[person];
    const list = Object.keys(entry.pids);
    const metas = list.map((pid) => ({
      pid,
      at: fb(`/statsProfiles/${pid}/createdAt`),
      owner: fb(`/statsProfiles/${pid}/ownerUid`),
      grants: Object.keys(fb(`/statsProfiles/${pid}/allowed`, ["--shallow"]) || {}).length,
    }));
    metas.sort((a, b) => {
      const aa = typeof a.at === "number" ? a.at : Infinity;
      const bb = typeof b.at === "number" ? b.at : Infinity;
      return aa !== bb ? aa - bb : a.pid < b.pid ? -1 : 1;
    });
    console.log(`person ${person}  devices=${entry.uids.length}`);
    metas.forEach((m, i) => {
      console.log(
        `   ${i === 0 ? "KEEP  " : "RETIRE"} ${m.pid}  grants=${m.grants}  ` +
          `createdAt=${m.at == null ? "(none)" : new Date(m.at).toISOString()}`
      );
    });
    const migrating = metas.slice(1).reduce((n, m) => n + m.grants, 0);
    console.log(`   -> ${migrating} grant(s) would migrate onto ${metas[0].pid}, ${metas.length - 1} profile(s) deleted\n`);
  }
}

main();

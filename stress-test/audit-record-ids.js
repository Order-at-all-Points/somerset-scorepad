#!/usr/bin/env node
"use strict";
/**
 * READ-ONLY. Did the legacy genRecordId() collision (F4/C5) actually damage
 * production data?
 *
 * F4 replaced `Date.now() + Math.floor(Math.random()*1000)` — which smeared ids
 * across a ~1s window rather than widening the id space — with a composed
 * `<millis>-<crypto>` id. That fix is forward-only by explicit decision: legacy
 * ids cannot be re-keyed because tombstones key on `matchUid || id` and synced
 * copies live at users/<uid>/history/<id>.
 *
 * So the open question is not "is the generator fixed" (it is, and its guard is
 * green) but "did the old one already lose games". Two distinct failure modes:
 *
 *  1. SAME-UID collision — the id IS the storage key, so the second archive
 *     overwrote the first under users/<uid>/history/<id>. Undetectable after the
 *     fact: only one record remains and nothing records that another existed.
 *     What IS measurable is the EXPOSURE: how many legacy-format ids remain.
 *  2. CROSS-UID collision within one person — mergedHistoryForStats dedups on
 *     `matchUid || id`, so two linked devices' CASUAL records (no matchUid)
 *     sharing an id silently drop one from merged Stats. This one is detectable,
 *     and it is live damage rather than historical.
 *
 * Reads record KEYS only (--shallow) plus each person's device list. Never reads
 * a record body: no deals, no player names, no digests.
 */
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const projIdx = args.indexOf("--project");
const PROJECT = projIdx !== -1 ? args[projIdx + 1] : "somerset-scorepad";
const FIREBASE = process.env.FIREBASE_BIN || "firebase";

function fb(dbPath, extra = []) {
  try {
    const out = execFileSync(FIREBASE, ["database:get", dbPath, "--project", PROJECT, ...extra], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(out || "null");
  } catch (e) {
    return null;
  }
}

// New format: "<millis>-<code>". Legacy: bare integer.
const isLegacy = (id) => /^\d+$/.test(id);

function main() {
  console.log(`Auditing record ids in ${PROJECT} (read-only, keys only)\n`);

  const uids = Object.keys(fb("/users", ["--shallow"]) || {});
  const personOf = fb("/personOf") || {};
  console.log(`  ${uids.length} uids under /users\n`);

  const idsByUid = {};
  let totalIds = 0, legacyIds = 0;
  for (const uid of uids) {
    const ids = Object.keys(fb(`/users/${uid}/history`, ["--shallow"]) || {});
    if (!ids.length) continue;
    idsByUid[uid] = ids;
    totalIds += ids.length;
    legacyIds += ids.filter(isLegacy).length;
  }

  const withHistory = Object.keys(idsByUid).length;
  console.log(`  ${withHistory} uid(s) have history, ${totalIds} record(s) total`);
  console.log(`  legacy-format ids (bare integer, pre-F4): ${legacyIds}`);
  console.log(`  composed ids (<millis>-<code>, post-F4):  ${totalIds - legacyIds}\n`);

  // Mode 2: cross-uid duplicate ids inside one person group.
  const byPerson = {};
  for (const uid of Object.keys(idsByUid)) {
    const person = personOf[uid];
    if (person == null) continue;
    (byPerson[person] = byPerson[person] || []).push(uid);
  }
  const multi = Object.keys(byPerson).filter((p) => byPerson[p].length > 1);
  console.log(`  ${Object.keys(byPerson).length} person group(s) hold history; ${multi.length} span >1 device\n`);

  let collisions = 0;
  for (const person of multi) {
    const seen = {};
    for (const uid of byPerson[person]) {
      for (const id of idsByUid[uid]) (seen[id] = seen[id] || []).push(uid);
    }
    const dupes = Object.keys(seen).filter((id) => seen[id].length > 1);
    if (!dupes.length) continue;
    collisions += dupes.length;
    console.log(`  *** person ${person}: ${dupes.length} id(s) shared across devices`);
    for (const id of dupes) console.log(`        ${id}  on ${seen[id].length} devices`);
  }

  console.log("");
  if (!collisions) {
    console.log("No cross-device id collisions. Nothing is currently being dropped from merged Stats.");
  } else {
    console.log(`${collisions} cross-device collision(s): merged Stats silently drops one record per collision.`);
    console.log("Only CASUAL records (no matchUid) are at risk — shared matches dedup on matchUid instead.");
  }
  if (legacyIds) {
    console.log(`\n${legacyIds} legacy id(s) remain. Same-uid overwrites among these are historical and`);
    console.log("undetectable (the overwritten record left no trace); this is the residual exposure the F4");
    console.log("note recorded as unrepairable, not new damage.");
  }
}

main();

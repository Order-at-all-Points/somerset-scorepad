"use strict";

const KEYS = {
  game: "somerset:dev-v1",
  history: "somerset:dev-history",
  tournament: "somerset:dev-tournament",
  names: "somerset:dev-names",
  myName: "somerset:dev-my-name",
  archivedMatches: "somerset:dev-archived-matches",
  syncCode: "somerset:dev-sync-code",
  syncRole: "somerset:dev-sync-role",
  deviceId: "somerset:dev-device-id",
  authUid: "somerset:dev-auth-uid",
  cloudSyncEnabled: "somerset:dev-cloud-sync-enabled",
  personId: "somerset:dev-person-id",
  linkedUids: "somerset:dev-linked-uids",
};

/** Read + JSON.parse a single localStorage key. Never throws. */
async function readKey(page, key) {
  const raw = await page.evaluate((k) => window.localStorage.getItem(k), key);
  if (raw === null || raw === undefined) return { ok: true, raw: null, value: null };
  try {
    return { ok: true, raw, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, raw, value: null, error: e.message };
  }
}

/** Snapshot every somerset:dev-* key at once, for diffing / archival. */
async function snapshotAll(page) {
  const out = {};
  for (const [name, key] of Object.entries(KEYS)) {
    out[name] = await readKey(page, key);
  }
  return out;
}

async function clearAll(page) {
  await page.evaluate(() => window.localStorage.clear());
}

/**
 * Wipe everything that identifies this device -- localStorage AND IndexedDB --
 * so a reload comes up as a genuinely fresh install.
 *
 * clearAll() alone is NOT a reinstall: Firebase Auth persists its session in
 * IndexedDB (`firebaseLocalStorageDb`), not localStorage, so the reload restores
 * the SAME anonymous authUid, subscribeMyHistory finds that uid's cloud backup and
 * correctly restores it. Measured: localStorage-only leaves the uid unchanged and
 * History repopulated; clearing both mints a new uid and comes up empty. Callers
 * simulating a reinstall must use this, or they are really testing "same device,
 * local data lost" -- which is the restore path, not a fresh install.
 */
async function simulateReinstall(page) {
  await page.evaluate(async () => {
    window.localStorage.clear();
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(d.name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          })
      )
    );
  });
}

module.exports = { KEYS, readKey, snapshotAll, clearAll, simulateReinstall };

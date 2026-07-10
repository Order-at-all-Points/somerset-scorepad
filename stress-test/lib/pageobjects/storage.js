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

module.exports = { KEYS, readKey, snapshotAll, clearAll };

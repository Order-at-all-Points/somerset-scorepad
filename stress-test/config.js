"use strict";
const path = require("path");

module.exports = {
  repoRoot: path.resolve(__dirname, ".."),
  artifactsDir: path.resolve(__dirname, "artifacts"),
  serverPort: 8934,
  headless: process.env.STRESS_HEADED ? false : true,
  // How long to wait for a Firebase write on one context to propagate to
  // another context's live subscription before comparing state.
  syncSettleMs: 4000,
  // Default per-action UI timeout (element appearance, etc).
  actionTimeoutMs: 8000,
  // Concurrency caps for the orchestrator's scenario queue.
  concurrency: {
    local: 4,
    // Measured empirically: concurrency 2 (each sync scenario opens 2
    // browser contexts, so 4+ simultaneous Firebase connections) produced
    // real net::ERR_TIMED_OUT failures in this sandbox that vanished when
    // the same scenarios were re-run in isolation. Sequential is slower but
    // reliable -- correctness matters more than speed here.
    sync: 1,
  },
  // Every device boots into an unconditional signInAnonymously() call (see
  // index.html's initAuth), so a full run can mint 60+ fresh anonymous users
  // in a couple minutes -- enough to trip Firebase's own anti-abuse rate
  // limiting on the Identity Toolkit endpoint (surfaces as a 400 on every
  // subsequent page load, app-wide, until it cools down). createDevice()
  // serializes new-device creation behind this minimum spacing so a run never
  // fires sign-ins faster than this, regardless of scenario concurrency.
  authThrottleMs: 1500,
};

#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const config = require("./config");
const server = require("./server");
const browserLib = require("./lib/browser");
const emulator = require("./lib/emulator");
const { FindingsStore } = require("./lib/findings");
const report = require("./lib/report");

const SCENARIO_FILES = [
  "casual-local",
  "casual-shared",
  "tournament-single-elim",
  "tournament-round-robin",
  "tournament-double-elim",
  "series-best-of",
  "sync-cross-cutting",
  "history-export-import",
  "device-linking",
  "stats-sharing",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { phase: "all", browser: "chromium", filter: null };
  for (const a of args) {
    if (a.startsWith("--phase=")) out.phase = a.slice("--phase=".length);
    else if (a.startsWith("--browser=")) out.browser = a.slice("--browser=".length);
    else if (a.startsWith("--filter=")) out.filter = a.slice("--filter=".length);
  }
  return out;
}

/** Runs `scenarios` through a fixed-size worker pool, one browser shared by all. */
async function runQueue(scenarios, browser, store, concurrency) {
  let idx = 0;
  const results = [];

  async function worker() {
    while (idx < scenarios.length) {
      const s = scenarios[idx++];
      const t0 = Date.now();
      console.log(`-> ${s.name}`);
      try {
        await s.run({ browser, store });
      } catch (e) {
        // Belt-and-suspenders: every scenario already wraps its own body in
        // try/catch and reports via its logger, but an error escaping that
        // (e.g. a bug in the scenario's own finally block) must still not
        // take down the rest of the run.
        const logger = store.newScenario(s.name);
        await logger.record({
          severity: "high",
          category: "scenario-crash",
          summary: `Unhandled error escaped the scenario: ${e.message}`,
          actual: e.stack,
        });
      }
      // NOTE: count by filtering `store.all` for this scenario's own name,
      // not a before/after length delta on the shared array -- under
      // concurrency, other scenarios push findings in between this
      // worker's before/after snapshots, which misattributes their
      // findings to whichever scenario happens to be straddling that
      // window. Filtering by name is race-free since every finding is
      // already correctly tagged with its own scenario at creation time.
      const findingCount = store.all.filter((f) => f.scenario === s.name).length;
      const durationMs = Date.now() - t0;
      console.log(`<- ${s.name} (${durationMs}ms, ${findingCount} finding${findingCount === 1 ? "" : "s"})`);
      results.push({ name: s.name, phase: s.phase, durationMs, findingCount });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, scenarios.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const opts = parseArgs();
  console.log(`Stress test run: phase=${opts.phase} browser=${opts.browser} filter=${opts.filter || "(none)"}`);

  fs.mkdirSync(config.artifactsDir, { recursive: true });
  await server.start(config.serverPort);
  console.log(`Static server up on :${config.serverPort}`);

  const store = new FindingsStore(config.artifactsDir);

  let gitCommit = "unknown";
  try {
    gitCommit = execSync("git rev-parse --short HEAD", { cwd: config.repoRoot }).toString().trim();
  } catch (e) {
    /* not fatal -- report just won't have a commit hash */
  }

  let allScenarios = [];
  for (const f of SCENARIO_FILES) {
    const mod = require(`./scenarios/${f}`);
    allScenarios = allScenarios.concat(mod);
  }
  if (opts.filter) allScenarios = allScenarios.filter((s) => s.name.includes(opts.filter));
  if (opts.phase !== "all") allScenarios = allScenarios.filter((s) => s.phase === opts.phase);

  console.log(`${allScenarios.length} scenarios selected`);

  const browser = await browserLib.launchBrowser(opts.browser);
  const startedAt = new Date();

  const localScenarios = allScenarios.filter((s) => s.phase === "local");
  const syncScenarios = allScenarios.filter((s) => s.phase === "sync");
  let scenarioResults = [];

  if (localScenarios.length) {
    console.log(`\n=== LOCAL phase: ${localScenarios.length} scenarios, concurrency ${config.concurrency.local} ===`);
    scenarioResults = scenarioResults.concat(
      await runQueue(localScenarios, browser, store, config.concurrency.local)
    );
  }
  if (syncScenarios.length) {
    console.log(`\n=== SYNC phase: ${syncScenarios.length} scenarios, concurrency ${config.concurrency.sync} ===`);
    scenarioResults = scenarioResults.concat(await runQueue(syncScenarios, browser, store, config.concurrency.sync));
  }

  // The sharing phase needs local emulators (see lib/emulator.js) -- it can't
  // run against production. Skip with a loud notice rather than failing the
  // run, so `--phase=all` still works on a machine without them; the notice
  // matters because silently skipping privacy guards is exactly how these bugs
  // survived to begin with. Concurrency is 1: these scenarios reset the shared
  // emulator database between each other.
  const sharingScenarios = allScenarios.filter((s) => s.phase === "sharing");
  let sharingSkipped = false;
  if (sharingScenarios.length) {
    if (await emulator.isUp()) {
      console.log(`\n=== SHARING phase: ${sharingScenarios.length} scenarios (local emulators), concurrency 1 ===`);
      scenarioResults = scenarioResults.concat(await runQueue(sharingScenarios, browser, store, 1));
    } else {
      sharingSkipped = true;
      console.log(
        `\n=== SHARING phase: SKIPPED — ${sharingScenarios.length} scenarios not run ===\n` +
        `    Firebase emulators unreachable at ${config.emulator.databaseUrl}.\n` +
        "    These guards cover Stats Sharing privacy/revocation and cannot run against production.\n" +
        "    Start them per .claude/skills/verify/SKILL.md, then re-run with --phase=sharing.");
    }
  }

  await browser.close();

  const runMeta = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    gitCommit,
    browser: opts.browser,
    phase: opts.phase,
    filter: opts.filter,
    scenarioCount: allScenarios.length,
    findingCount: store.all.length,
    sharingPhaseSkipped: sharingSkipped,
    scenarioResults,
  };
  fs.writeFileSync(path.join(config.artifactsDir, "run-summary.json"), JSON.stringify(runMeta, null, 2));

  const reportPath = report.generate(store, runMeta);
  console.log(`\nDone. ${allScenarios.length} scenarios, ${store.all.length} findings.`);
  console.log(`Report: ${reportPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Orchestrator crashed:", e);
  process.exit(1);
});

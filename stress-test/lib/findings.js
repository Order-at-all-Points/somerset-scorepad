"use strict";
const fs = require("fs");
const path = require("path");

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

class ScenarioLogger {
  constructor(store, scenarioName) {
    this.store = store;
    this.scenarioName = scenarioName;
    this.steps = [];
    this.findingCount = 0;
  }

  step(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    this.steps.push(line);
    if (process.env.STRESS_VERBOSE) console.log(`  ${this.scenarioName} :: ${msg}`);
  }

  /**
   * Record a finding. Never throws -- a broken finding capture must not take
   * down the scenario that's reporting a real bug.
   */
  async record({ severity, category, summary, expected, actual, page, pages, contextLabel, extra }) {
    this.findingCount++;
    const id = `${this.scenarioName}-${this.findingCount}`;
    const finding = {
      id,
      ts: new Date().toISOString(),
      scenario: this.scenarioName,
      severity: severity || "medium",
      category: category || "uncategorized",
      summary,
      expected: expected === undefined ? null : expected,
      actual: actual === undefined ? null : actual,
      contextLabel: contextLabel || null,
      steps: this.steps.slice(),
      screenshots: [],
      extra: extra || null,
    };

    const shotTargets = [];
    if (page) shotTargets.push([contextLabel || "page", page]);
    if (pages) for (const [label, p] of Object.entries(pages)) shotTargets.push([label, p]);

    for (const [label, p] of shotTargets) {
      try {
        const shotPath = path.join(this.store.screenshotsDir, `${id}-${label}.png`);
        await p.screenshot({ path: shotPath, timeout: 5000 });
        finding.screenshots.push(path.relative(this.store.artifactsDir, shotPath));
      } catch (e) {
        // Page may already be closed/crashed -- that's fine, note it and move on.
        finding.screenshots.push(`(screenshot failed for ${label}: ${e.message})`);
      }
    }

    this.store._write(finding);
    console.log(`  [FINDING ${finding.severity.toUpperCase()}] ${this.scenarioName}: ${summary}`);
    return finding;
  }
}

class FindingsStore {
  constructor(artifactsDir) {
    this.artifactsDir = artifactsDir;
    this.screenshotsDir = path.join(artifactsDir, "screenshots");
    this.snapshotsDir = path.join(artifactsDir, "storage-snapshots");
    // Fresh run -- stale screenshots from a prior run (e.g. one that hit a
    // transient network issue that didn't reproduce on re-run) would
    // otherwise accumulate forever, unreferenced by the current findings.
    fs.rmSync(this.screenshotsDir, { recursive: true, force: true });
    fs.rmSync(this.snapshotsDir, { recursive: true, force: true });
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    fs.mkdirSync(this.snapshotsDir, { recursive: true });
    this.jsonlPath = path.join(artifactsDir, "findings.jsonl");
    fs.writeFileSync(this.jsonlPath, ""); // fresh run
    this.all = [];
  }

  newScenario(name) {
    return new ScenarioLogger(this, name);
  }

  _write(finding) {
    this.all.push(finding);
    fs.appendFileSync(this.jsonlPath, JSON.stringify(finding) + "\n");
  }

  /** Persist a storage snapshot object to disk and return its relative path. */
  saveSnapshot(name, obj) {
    const p = path.join(this.snapshotsDir, `${name}.json`);
    fs.writeFileSync(p, JSON.stringify(obj, null, 2));
    return path.relative(this.artifactsDir, p);
  }

  sorted() {
    return this.all.slice().sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  }
}

module.exports = { FindingsStore, SEVERITY_ORDER };

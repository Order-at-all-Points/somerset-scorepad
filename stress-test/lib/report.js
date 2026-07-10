"use strict";
const fs = require("fs");
const path = require("path");

const MODE_BUCKETS = [
  { label: "Casual Game", prefixes: ["casual-local", "casual-shared"] },
  { label: "Single Elimination", prefixes: ["tournament-single-elim"] },
  { label: "Double Elimination", prefixes: ["tournament-double-elim"] },
  { label: "Round Robin", prefixes: ["tournament-round-robin"] },
  { label: "Best-of Series", prefixes: ["series-best-of"] },
];
const CROSS_CUTTING_PREFIXES = ["sync-cross-cutting", "history-export-import"];

const SEVERITY_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" };

function prefixOf(name) {
  return name.split("/")[0];
}

function matrixCell(results) {
  if (!results.length) return "—";
  const pass = results.filter((r) => r.findingCount === 0).length;
  const fail = results.length - pass;
  if (fail === 0) return `✅ ${pass}/${results.length}`;
  return `⚠️ ${pass}/${results.length} (${fail} with findings)`;
}

function buildMatrix(scenarioResults) {
  const rows = [["Mode", "Local", "Sync"]];
  for (const bucket of MODE_BUCKETS) {
    const forBucket = scenarioResults.filter((r) => bucket.prefixes.includes(prefixOf(r.name)));
    const local = forBucket.filter((r) => r.phase === "local");
    const sync = forBucket.filter((r) => r.phase === "sync");
    rows.push([bucket.label, matrixCell(local), matrixCell(sync)]);
  }
  return rows;
}

function mdTable(rows) {
  const [header, ...body] = rows;
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ];
  return lines.join("\n");
}

function findingSection(f) {
  const lines = [
    `### [${SEVERITY_LABEL[f.severity] || f.severity}] ${f.summary}`,
    "",
    `- **Scenario:** \`${f.scenario}\``,
    `- **Category:** ${f.category}`,
  ];
  if (f.contextLabel) lines.push(`- **Device:** ${f.contextLabel}`);
  if (f.expected !== null && f.expected !== undefined) lines.push(`- **Expected:** ${JSON.stringify(f.expected)}`);
  if (f.actual !== null && f.actual !== undefined) lines.push(`- **Actual:** ${JSON.stringify(f.actual)}`);
  if (f.screenshots && f.screenshots.length) {
    lines.push(`- **Screenshots:** ${f.screenshots.join(", ")}`);
  }
  if (f.steps && f.steps.length) {
    lines.push("", "<details><summary>Repro steps</summary>", "", "```", ...f.steps, "```", "</details>");
  }
  lines.push("");
  return lines.join("\n");
}

function generate(store, runMeta) {
  const findings = store.sorted();
  const scenarioResults = runMeta.scenarioResults || [];

  const lines = [];
  lines.push("# Some-R-Set Scorepad -- Stress Test Report");
  lines.push("");
  lines.push(`- **Run started:** ${runMeta.startedAt}`);
  lines.push(`- **Duration:** ${(runMeta.durationMs / 1000).toFixed(1)}s`);
  lines.push(`- **Git commit:** \`${runMeta.gitCommit}\``);
  lines.push(`- **Browser:** ${runMeta.browser}`);
  lines.push(`- **Phase(s) run:** ${runMeta.phase}`);
  lines.push(`- **Scenarios:** ${runMeta.scenarioCount}`);
  lines.push(`- **Findings:** ${findings.length}`);
  lines.push("");

  lines.push("## Pass/fail matrix");
  lines.push("");
  lines.push(mdTable(buildMatrix(scenarioResults)));
  lines.push("");
  const crossCutting = scenarioResults.filter((r) => CROSS_CUTTING_PREFIXES.includes(prefixOf(r.name)));
  if (crossCutting.length) {
    lines.push("**Cross-cutting sync/history checks:**");
    lines.push("");
    lines.push(
      mdTable([
        ["Scenario", "Result"],
        ...crossCutting.map((r) => [r.name, r.findingCount === 0 ? "✅ pass" : `⚠️ ${r.findingCount} finding(s)`]),
      ])
    );
    lines.push("");
  }

  lines.push("## Regression checks (recent commits)");
  lines.push("");
  lines.push(
    "These reproduce the last 5 `dev` commits touching best-of-series escalation and shared-history sync, so a break here is a direct regression, not new territory:"
  );
  lines.push("");
  const regressionResults = scenarioResults.filter((r) => r.name.includes("regression"));
  if (regressionResults.length) {
    lines.push(
      mdTable([
        ["Scenario", "Result"],
        ...regressionResults.map((r) => [r.name, r.findingCount === 0 ? "✅ held" : `❌ ${r.findingCount} finding(s)`]),
      ])
    );
  } else {
    lines.push("_No regression scenarios ran in this phase selection._");
  }
  lines.push("");

  lines.push("## Findings");
  lines.push("");
  if (!findings.length) {
    lines.push("No findings. 🎉");
  } else {
    const bySeverity = { critical: [], high: [], medium: [], low: [], info: [] };
    for (const f of findings) (bySeverity[f.severity] || bySeverity.info).push(f);
    for (const sev of ["critical", "high", "medium", "low", "info"]) {
      if (!bySeverity[sev].length) continue;
      lines.push(`### ${SEVERITY_LABEL[sev]} (${bySeverity[sev].length})`);
      lines.push("");
      for (const f of bySeverity[sev]) lines.push(findingSection(f));
    }
  }

  lines.push("## Prioritization guidance");
  lines.push("");
  lines.push("Suggested fix order, most impactful first:");
  lines.push("");
  lines.push("1. **scoring-correctness** -- corrupts game state, affects every mode.");
  lines.push("2. **sync-divergence** -- data integrity across devices; silent data loss or duplication.");
  lines.push("3. **regression-repro** -- known-fixed bugs, catch before they ship again.");
  lines.push("4. **ui-stuck** / lock-contention -- blocks legitimate use, usually recoverable by reload.");
  lines.push("5. **correctness** (non-scoring) / **console-error** -- polish and robustness.");
  lines.push("");

  lines.push("## Known coverage gaps");
  lines.push("");
  lines.push("- The 10-minute per-hand stale-lock timeout (`LOCK_TIMEOUT_MS`) is not exercised -- waiting 10 real minutes per run isn't practical for a sweep.");
  lines.push("- Tournament/session expiry at 48h (`_createdAt`-anchored) is not exercised for the same reason.");
  lines.push("- Only Chromium was run by default; a webkit pass over the sync-critical subset is supported (`--browser=webkit`) but not run automatically every time.");
  lines.push("- Native OS share-sheet export (`navigator.share`) is stubbed out in favor of the deterministic `<a download>` path; the share-sheet UI itself isn't exercised.");
  lines.push("");

  const md = lines.join("\n");
  const mdPath = path.join(store.artifactsDir, "report.md");
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(path.join(store.artifactsDir, "report.json"), JSON.stringify({ runMeta, findings }, null, 2));
  return mdPath;
}

module.exports = { generate };

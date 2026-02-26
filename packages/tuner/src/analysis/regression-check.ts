/**
 * Regression check — compares the current cycle's baseline metrics to the
 * previous cycle, detecting regressions at the aggregate, per-metric, and
 * per-Elo-band level.
 *
 * Runs BEFORE Claude analysis so the researcher (and Claude) can see what
 * improved and what regressed before making tuning decisions.
 */

import type { AggregatedResult, CycleRecord } from "../state/types";
import { compositeScore, formatStrength } from "../scoring/composite-score";
import type { HistoricalBaseline } from "./prompt-builder";

/* ── Types ───────────────────────────────────────────────── */

export interface MetricDelta {
  metric: string;
  previous: number;
  current: number;
  /** Signed change — positive means the metric moved in the GOOD direction */
  delta: number;
  direction: "improved" | "regressed" | "stable";
  severity: "none" | "minor" | "critical";
  displayPrevious: string;
  displayCurrent: string;
  displayDelta: string;
}

export interface EloBandDelta {
  dataset: string;
  elo: number;
  previousScore: number;
  currentScore: number;
  scoreDelta: number;
  severity: "none" | "minor" | "critical";
  strengthPrevious: string;
  strengthCurrent: string;
  convergenceDirection: "converging" | "diverging" | "stable";
}

export interface ConfigDiff {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  source: string;
}

export interface RegressionReport {
  hasPreviousCycle: boolean;
  previousCycleNumber: number;
  currentCycleNumber: number;
  overallVerdict: "improved" | "regressed" | "stable";
  overallSeverity: "none" | "minor" | "critical";
  previousScore: number;
  currentScore: number;
  compositeScoreDelta: number;
  metricDeltas: MetricDelta[];
  eloBandDeltas: EloBandDelta[];
  strengthCalibration: {
    previousAvgGap: number;
    currentAvgGap: number;
    direction: "converging" | "diverging" | "stable";
  };
  configDiffs: ConfigDiff[];
  researcherNotes: string[];
}

/* ── Thresholds ──────────────────────────────────────────── */

/** Thresholds in absolute units (rates as [0,1], CPL as centipawns) */
const THRESHOLDS = {
  compositeScore: { minor: 0.005, critical: 0.015 },
  matchRate:      { minor: 0.02,  critical: 0.05 },
  topNRate:       { minor: 0.02,  critical: 0.05 },
  bookCoverage:   { minor: 0.03,  critical: 0.08 },
  cplDelta:       { minor: 2,     critical: 5 },
  cplSimilarity:  { minor: 3,     critical: 8 },
  eloBand:        { minor: 0.02,  critical: 0.05 },
};

/* ── Core regression check ───────────────────────────────── */

export function runRegressionCheck(
  currentBaseline: AggregatedResult,
  previousBaseline: AggregatedResult,
  currentCycle: number,
  previousCycle: number,
  completedCycles: CycleRecord[],
  allHistoricalBaselines?: HistoricalBaseline[]
): RegressionReport {
  const curr = currentBaseline.aggregatedMetrics;
  const prev = previousBaseline.aggregatedMetrics;

  // ── Per-metric deltas ──
  const metricDeltas: MetricDelta[] = [];

  // Higher-is-better metrics
  for (const key of ["matchRate", "topNRate", "bookCoverage"] as const) {
    const th = THRESHOLDS[key];
    const prevVal = prev[key];
    const currVal = curr[key];
    const delta = currVal - prevVal;

    // Skip metrics that were previously zero (unmeasured, e.g. topNRate with skipTopN)
    const wasPreviouslyZero = prevVal === 0 && currVal > 0;

    metricDeltas.push({
      metric: key,
      previous: prevVal,
      current: currVal,
      delta,
      direction: wasPreviouslyZero ? "improved" : classifyDirection(delta, th, "higher"),
      severity: wasPreviouslyZero ? "none" : classifySeverity(delta, th, "higher"),
      displayPrevious: formatPercent(prevVal),
      displayCurrent: formatPercent(currVal),
      displayDelta: formatPercentDelta(delta) + (wasPreviouslyZero ? " (new)" : ""),
    });
  }

  // Lower-is-better: cplDelta (closer to 0 = bot error pattern matches player better)
  {
    const prevVal = prev.cplDelta;
    const currVal = curr.cplDelta;
    const delta = prevVal - currVal; // positive = improved (delta got smaller)
    const th = THRESHOLDS.cplDelta;

    metricDeltas.push({
      metric: "cplDelta",
      previous: prevVal,
      current: currVal,
      delta,
      direction: classifyDirection(delta, th, "lower-raw"),
      severity: classifySeverity(delta, th, "lower-raw"),
      displayPrevious: prevVal.toFixed(1),
      displayCurrent: currVal.toFixed(1),
      displayDelta: (delta >= 0 ? "-" : "+") + Math.abs(delta).toFixed(1) + "cp",
    });
  }

  // Lower-is-better: |botCPL - actualCPL| (strength calibration gap)
  {
    const prevGap = Math.abs(prev.avgBotCPL - prev.avgActualCPL);
    const currGap = Math.abs(curr.avgBotCPL - curr.avgActualCPL);
    const delta = prevGap - currGap; // positive = improved (gap shrank)
    const th = THRESHOLDS.cplSimilarity;

    metricDeltas.push({
      metric: "|bot-actual|",
      previous: prevGap,
      current: currGap,
      delta,
      direction: classifyDirection(delta, th, "lower-raw"),
      severity: classifySeverity(delta, th, "lower-raw"),
      displayPrevious: prevGap.toFixed(1),
      displayCurrent: currGap.toFixed(1),
      displayDelta: (delta >= 0 ? "-" : "+") + Math.abs(delta).toFixed(1) + "cp",
    });
  }

  // ── Per-Elo-band deltas ──
  const eloBandDeltas: EloBandDelta[] = [];
  const currentDatasets = currentBaseline.datasetMetrics.slice().sort((a, b) => a.elo - b.elo);

  for (const ds of currentDatasets) {
    const prevDs = previousBaseline.datasetMetrics.find((d) => d.dataset === ds.dataset);
    if (!prevDs) continue; // New dataset — no comparison

    const prevScore = compositeScore(prevDs.metrics);
    const currScore = compositeScore(ds.metrics);
    const scoreDelta = currScore - prevScore;
    const th = THRESHOLDS.eloBand;

    const prevGap = Math.abs(prevDs.metrics.avgBotCPL - prevDs.metrics.avgActualCPL);
    const currGap = Math.abs(ds.metrics.avgBotCPL - ds.metrics.avgActualCPL);
    const gapDelta = prevGap - currGap; // positive = converging

    eloBandDeltas.push({
      dataset: ds.dataset,
      elo: ds.elo,
      previousScore: prevScore,
      currentScore: currScore,
      scoreDelta,
      severity: classifySeverity(scoreDelta, th, "higher"),
      strengthPrevious: formatStrength(prevDs.metrics.avgActualCPL, prevDs.metrics.avgBotCPL),
      strengthCurrent: formatStrength(ds.metrics.avgActualCPL, ds.metrics.avgBotCPL),
      convergenceDirection:
        Math.abs(gapDelta) < 1.5 ? "stable" : gapDelta > 0 ? "converging" : "diverging",
    });
  }

  // ── Strength calibration summary ──
  const prevBands = previousBaseline.datasetMetrics;
  const currBands = currentBaseline.datasetMetrics;
  const prevAvgGap =
    prevBands.length > 0
      ? prevBands.reduce((s, d) => s + Math.abs(d.metrics.avgBotCPL - d.metrics.avgActualCPL), 0) /
        prevBands.length
      : 0;
  const currAvgGap =
    currBands.length > 0
      ? currBands.reduce((s, d) => s + Math.abs(d.metrics.avgBotCPL - d.metrics.avgActualCPL), 0) /
        currBands.length
      : 0;
  const gapDelta = prevAvgGap - currAvgGap;

  // ── Config diffs ──
  const configDiffs = extractConfigDiffs(completedCycles, previousCycle, currentCycle);

  // ── Overall verdict ──
  const compositeScoreDelta = currentBaseline.compositeScore - previousBaseline.compositeScore;
  const overallTh = THRESHOLDS.compositeScore;
  const overallVerdict = classifyDirection(compositeScoreDelta, overallTh, "higher");
  const overallSeverity = classifySeverity(compositeScoreDelta, overallTh, "higher");

  // ── Researcher notes (multi-cycle trend detection) ──
  const researcherNotes = generateResearcherNotes(
    metricDeltas,
    eloBandDeltas,
    allHistoricalBaselines ?? [],
    currentBaseline
  );

  return {
    hasPreviousCycle: true,
    previousCycleNumber: previousCycle,
    currentCycleNumber: currentCycle,
    overallVerdict,
    overallSeverity,
    previousScore: previousBaseline.compositeScore,
    currentScore: currentBaseline.compositeScore,
    compositeScoreDelta,
    metricDeltas,
    eloBandDeltas,
    strengthCalibration: {
      previousAvgGap: prevAvgGap,
      currentAvgGap: currAvgGap,
      direction: Math.abs(gapDelta) < 1.5 ? "stable" : gapDelta > 0 ? "converging" : "diverging",
    },
    configDiffs,
    researcherNotes,
  };
}

/* ── Console output ──────────────────────────────────────── */

export function printRegressionReport(report: RegressionReport): void {
  console.log("\n  ╔══════════════════════════════════════════╗");
  console.log(
    `  ║  Regression Check: Cycle ${String(report.previousCycleNumber).padStart(2)} → ${String(report.currentCycleNumber).padStart(2)}         ║`
  );
  console.log("  ╚══════════════════════════════════════════╝\n");

  // Overall
  const prevPct = (report.previousScore * 100).toFixed(2);
  const currPct = (report.currentScore * 100).toFixed(2);
  const deltaPct = formatPercentDelta(report.compositeScoreDelta);
  const icon = verdictIcon(report.overallVerdict, report.overallSeverity);
  console.log(`  Overall: ${prevPct}% → ${currPct}% (${deltaPct})  ${icon} ${report.overallVerdict.toUpperCase()}\n`);

  // Metric breakdown
  console.log("  ── Metric Breakdown ──");
  for (const md of report.metricDeltas) {
    const icon2 = metricIcon(md.direction, md.severity);
    const severityNote =
      md.severity === "critical"
        ? "  CRITICAL regression"
        : md.severity === "minor"
          ? "  minor regression"
          : "";
    console.log(
      `    ${md.metric.padEnd(14)} ${md.displayPrevious.padStart(7)} → ${md.displayCurrent.padStart(7)}  ${md.displayDelta.padStart(10)}  ${icon2}${severityNote}`
    );
  }
  console.log();

  // Per-Elo-Band
  if (report.eloBandDeltas.length > 0) {
    console.log("  ── Per-Elo-Band ──");
    for (const eb of report.eloBandDeltas) {
      const deltaPctBand = formatPercentDelta(eb.scoreDelta);
      const convIcon =
        eb.convergenceDirection === "diverging"
          ? "DIVERGING ⚠"
          : eb.convergenceDirection === "converging"
            ? "converging"
            : "stable";
      console.log(
        `    ${(eb.dataset + " (" + eb.elo + ")").padEnd(24)} ${deltaPctBand.padStart(8)}  ${eb.strengthPrevious.padEnd(16)} → ${eb.strengthCurrent.padEnd(16)} ${convIcon}`
      );
    }
    console.log();
  }

  // Strength calibration
  console.log("  ── Strength Calibration ──");
  const sc = report.strengthCalibration;
  console.log(
    `    Avg |botCPL - actualCPL|: ${sc.previousAvgGap.toFixed(1)} → ${sc.currentAvgGap.toFixed(1)}  ${sc.direction}\n`
  );

  // Config changes
  if (report.configDiffs.length > 0) {
    console.log("  ── Config Changes Since Last Cycle ──");
    for (const cd of report.configDiffs) {
      console.log(
        `    ${cd.source}: ${cd.path}: ${JSON.stringify(cd.oldValue)} → ${JSON.stringify(cd.newValue)}`
      );
    }
    console.log();
  }

  // Researcher notes
  if (report.researcherNotes.length > 0) {
    console.log("  ── Researcher Notes ──");
    for (const note of report.researcherNotes) {
      console.log(`    ⚠ ${note}`);
    }
    console.log();
  }
}

/* ── Prompt formatting ───────────────────────────────────── */

export function formatRegressionForPrompt(report: RegressionReport): string {
  const lines: string[] = [];

  // Overall
  const prevPct = (report.previousScore * 100).toFixed(2);
  const currPct = (report.currentScore * 100).toFixed(2);
  const deltaPp = formatPercentDelta(report.compositeScoreDelta);
  lines.push(`Overall: ${prevPct}% → ${currPct}% (${deltaPp}) — **${report.overallVerdict.toUpperCase()}**`);
  if (report.overallSeverity === "critical") {
    lines.push("**⚠ CRITICAL REGRESSION DETECTED — address this before further optimization.**");
  }
  lines.push("");

  // Metric comparison table
  lines.push("### Metric Comparison (Previous Cycle → Current)");
  lines.push("| Metric | Previous | Current | Delta | Status |");
  lines.push("|--------|----------|---------|-------|--------|");
  for (const md of report.metricDeltas) {
    const status =
      md.severity === "critical"
        ? "⚠ CRITICAL"
        : md.severity === "minor"
          ? "⚠ minor regression"
          : md.direction === "improved"
            ? "✓ improved"
            : "— stable";
    lines.push(
      `| ${md.metric} | ${md.displayPrevious} | ${md.displayCurrent} | ${md.displayDelta} | ${status} |`
    );
  }
  lines.push("");

  // Per-Elo-band comparison
  if (report.eloBandDeltas.length > 0) {
    lines.push("### Per-Elo-Band Comparison");
    lines.push(
      "| Dataset (Elo) | Prev Score | Curr Score | Delta | Strength Prev | Strength Curr | Convergence |"
    );
    lines.push("|---------------|------------|------------|-------|---------------|---------------|-------------|");
    for (const eb of report.eloBandDeltas) {
      lines.push(
        `| ${eb.dataset} (${eb.elo}) | ${(eb.previousScore * 100).toFixed(2)}% | ${(eb.currentScore * 100).toFixed(2)}% | ${formatPercentDelta(eb.scoreDelta)} | ${eb.strengthPrevious} | ${eb.strengthCurrent} | ${eb.convergenceDirection} |`
      );
    }
    lines.push("");
  }

  // Strength calibration
  const sc = report.strengthCalibration;
  lines.push("### Strength Calibration");
  lines.push(
    `Avg |botCPL - actualCPL|: ${sc.previousAvgGap.toFixed(1)} → ${sc.currentAvgGap.toFixed(1)} — **${sc.direction}**`
  );
  lines.push("");

  // Config diffs
  if (report.configDiffs.length > 0) {
    lines.push("### Config Changes Between Cycles");
    lines.push("| Source | Path | Old Value | New Value |");
    lines.push("|--------|------|-----------|-----------|");
    for (const cd of report.configDiffs) {
      lines.push(
        `| ${cd.source} | ${cd.path} | ${JSON.stringify(cd.oldValue)} | ${JSON.stringify(cd.newValue)} |`
      );
    }
    lines.push("");
  }

  // Researcher notes
  if (report.researcherNotes.length > 0) {
    lines.push("### Researcher Notes");
    for (const note of report.researcherNotes) {
      lines.push(`- ⚠ ${note}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/* ── Helpers ─────────────────────────────────────────────── */

function classifyDirection(
  delta: number,
  thresholds: { minor: number; critical: number },
  mode: "higher" | "lower-raw"
): "improved" | "regressed" | "stable" {
  // For "higher" mode: positive delta = improved
  // For "lower-raw" mode: positive delta means the value decreased = improved
  const effectiveDelta = mode === "higher" ? delta : delta;
  if (effectiveDelta > thresholds.minor * 0.5) return "improved";
  if (effectiveDelta < -thresholds.minor) return "regressed";
  return "stable";
}

function classifySeverity(
  delta: number,
  thresholds: { minor: number; critical: number },
  mode: "higher" | "lower-raw"
): "none" | "minor" | "critical" {
  const effectiveDelta = mode === "higher" ? delta : delta;
  if (effectiveDelta >= -thresholds.minor) return "none";
  if (effectiveDelta >= -thresholds.critical) return "minor";
  return "critical";
}

function formatPercent(val: number): string {
  return (val * 100).toFixed(1) + "%";
}

function formatPercentDelta(val: number): string {
  const pp = val * 100;
  return (pp >= 0 ? "+" : "") + pp.toFixed(2) + "pp";
}

function verdictIcon(verdict: string, severity: string): string {
  if (verdict === "improved") return "✓";
  if (severity === "critical") return "✗";
  if (severity === "minor") return "⚠";
  return "—";
}

function metricIcon(direction: string, severity: string): string {
  if (direction === "improved") return "✓";
  if (severity === "critical") return "✗";
  if (severity === "minor") return "⚠";
  return "—";
}

function extractConfigDiffs(
  completedCycles: CycleRecord[],
  previousCycle: number,
  currentCycle: number
): ConfigDiff[] {
  const relevant = completedCycles.filter(
    (c) => c.cycle >= previousCycle && c.cycle < currentCycle && c.accepted && c.configChanges.length > 0
  );

  return relevant.flatMap((c) =>
    c.configChanges.map((change) => ({
      path: change.path,
      oldValue: change.oldValue,
      newValue: change.newValue,
      source: `Cycle ${c.cycle} (accepted)`,
    }))
  );
}

function generateResearcherNotes(
  metricDeltas: MetricDelta[],
  eloBandDeltas: EloBandDelta[],
  allHistoricalBaselines: HistoricalBaseline[],
  currentBaseline: AggregatedResult
): string[] {
  const notes: string[] = [];

  // Detect multi-cycle declining metrics using historical baselines
  if (allHistoricalBaselines.length >= 2) {
    // Check each rate metric for consecutive declines
    for (const key of ["matchRate", "topNRate", "bookCoverage"] as const) {
      let consecutiveDeclines = 0;
      const baselines = [...allHistoricalBaselines.map((h) => h.baseline), currentBaseline];

      for (let i = 1; i < baselines.length; i++) {
        if (baselines[i].aggregatedMetrics[key] < baselines[i - 1].aggregatedMetrics[key]) {
          consecutiveDeclines++;
        } else {
          consecutiveDeclines = 0;
        }
      }

      if (consecutiveDeclines >= 2) {
        notes.push(
          `${key} has declined for ${consecutiveDeclines} consecutive cycles — consider investigating root cause`
        );
      }
    }

    // Check cplDelta for consecutive increases (worse)
    let cplDeclines = 0;
    const baselines = [...allHistoricalBaselines.map((h) => h.baseline), currentBaseline];
    for (let i = 1; i < baselines.length; i++) {
      if (
        baselines[i].aggregatedMetrics.cplDelta >
        baselines[i - 1].aggregatedMetrics.cplDelta
      ) {
        cplDeclines++;
      } else {
        cplDeclines = 0;
      }
    }
    if (cplDeclines >= 2) {
      notes.push(
        `cplDelta has worsened for ${cplDeclines} consecutive cycles — error pattern fit is deteriorating`
      );
    }
  }

  // Flag any diverging Elo bands
  for (const eb of eloBandDeltas) {
    if (eb.convergenceDirection === "diverging" && eb.severity !== "none") {
      notes.push(
        `${eb.dataset} (${eb.elo} Elo) strength diverging — investigate ${eb.elo < 1400 ? "beginner" : eb.elo < 1800 ? "intermediate" : eb.elo < 2200 ? "advanced" : "expert"} band calibration`
      );
    }
  }

  // Flag if overall improved but individual metrics regressed critically
  const criticalMetrics = metricDeltas.filter((m) => m.severity === "critical");
  if (criticalMetrics.length > 0 && metricDeltas.some((m) => m.direction === "improved")) {
    notes.push(
      `Overall score improved but ${criticalMetrics.map((m) => m.metric).join(", ")} regressed critically — composite score may be masking problems`
    );
  }

  return notes;
}

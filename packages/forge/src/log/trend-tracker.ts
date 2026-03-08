/**
 * Metric trend tracking across experiments in a session.
 *
 * Tracks how metrics evolve across experiments to detect
 * convergence, regressions, and overall progress.
 */

import type { ExperimentRecord } from "../state/types";

export interface TrendPoint {
  experimentNumber: number;
  moveAccuracy: number;
  cplKLDivergence: number;
  blunderRateMatch: number;
  compositeScore: number;
  changeDescription: string;
  conclusion: string;
}

export interface TrendSummary {
  points: TrendPoint[];
  bestAccuracy: { value: number; experiment: number };
  bestComposite: { value: number; experiment: number };
  /** Metric has not improved in last N experiments */
  plateauDetected: boolean;
  /** Number of experiments since last improvement */
  experimentsSinceImprovement: number;
  /** Overall direction: improving, degrading, or flat */
  direction: "improving" | "degrading" | "flat";
}

/**
 * Compute trend summary from a list of experiments.
 */
export function computeTrend(
  experiments: ExperimentRecord[],
  plateauThreshold = 5
): TrendSummary {
  if (experiments.length === 0) {
    return {
      points: [],
      bestAccuracy: { value: 0, experiment: 0 },
      bestComposite: { value: 0, experiment: 0 },
      plateauDetected: false,
      experimentsSinceImprovement: 0,
      direction: "flat",
    };
  }

  const points: TrendPoint[] = experiments.map((exp) => ({
    experimentNumber: exp.number,
    moveAccuracy: exp.result.moveAccuracy,
    cplKLDivergence: exp.result.cplKLDivergence,
    blunderRateMatch: 1 - exp.result.blunderRateDelta.overall,
    compositeScore: exp.result.compositeScore,
    changeDescription: [
      ...exp.codeChanges.map((c) => c.description),
      ...exp.configChanges.map((c) => c.description),
    ].join("; ") || "(no changes)",
    conclusion: exp.conclusion,
  }));

  // Find best accuracy and composite
  let bestAccuracy = { value: 0, experiment: 0 };
  let bestComposite = { value: 0, experiment: 0 };

  for (const point of points) {
    if (point.moveAccuracy > bestAccuracy.value) {
      bestAccuracy = {
        value: point.moveAccuracy,
        experiment: point.experimentNumber,
      };
    }
    if (point.compositeScore > bestComposite.value) {
      bestComposite = {
        value: point.compositeScore,
        experiment: point.experimentNumber,
      };
    }
  }

  // Detect plateau (no composite improvement in last N experiments)
  const lastImprovement = bestComposite.experiment;
  const currentExperiment = points[points.length - 1].experimentNumber;
  const experimentsSinceImprovement = currentExperiment - lastImprovement;
  const plateauDetected = experimentsSinceImprovement >= plateauThreshold;

  // Overall direction (compare first third vs last third)
  let direction: TrendSummary["direction"] = "flat";
  if (points.length >= 3) {
    const third = Math.floor(points.length / 3);
    const firstThird = points.slice(0, third);
    const lastThird = points.slice(-third);

    const avgFirst =
      firstThird.reduce((s, p) => s + p.compositeScore, 0) / firstThird.length;
    const avgLast =
      lastThird.reduce((s, p) => s + p.compositeScore, 0) / lastThird.length;

    if (avgLast > avgFirst + 0.01) direction = "improving";
    else if (avgLast < avgFirst - 0.01) direction = "degrading";
  }

  return {
    points,
    bestAccuracy,
    bestComposite,
    plateauDetected,
    experimentsSinceImprovement,
    direction,
  };
}

/**
 * Format trend summary as a readable string for the agent.
 */
export function formatTrend(summary: TrendSummary): string {
  const lines: string[] = [];

  lines.push("Experiment Trend");
  lines.push("═══════════════════════════════════════");
  lines.push(`Direction: ${summary.direction}`);
  lines.push(
    `Best accuracy: ${(summary.bestAccuracy.value * 100).toFixed(1)}% (exp #${summary.bestAccuracy.experiment})`
  );
  lines.push(
    `Best composite: ${summary.bestComposite.value.toFixed(4)} (exp #${summary.bestComposite.experiment})`
  );

  if (summary.plateauDetected) {
    lines.push(
      `⚠ PLATEAU: No improvement in ${summary.experimentsSinceImprovement} experiments`
    );
  }

  lines.push("");
  lines.push(
    "  #  | Accuracy | CPL KL  | Blunder | Composite | Status"
  );
  lines.push(
    "-----|----------|---------|---------|-----------|--------"
  );

  for (const p of summary.points) {
    const num = String(p.experimentNumber).padStart(3);
    const acc = `${(p.moveAccuracy * 100).toFixed(1)}%`.padStart(7);
    const kl = p.cplKLDivergence.toFixed(4).padStart(7);
    const blunder = p.blunderRateMatch.toFixed(4).padStart(7);
    const comp = p.compositeScore.toFixed(4).padStart(8);
    const status = p.conclusion.slice(0, 8).padEnd(8);

    lines.push(`  ${num} | ${acc} | ${kl} | ${blunder} | ${comp} | ${status}`);
  }

  return lines.join("\n");
}

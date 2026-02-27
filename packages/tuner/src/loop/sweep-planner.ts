/**
 * Sweep planner — generates experiment specs from the parameter registry.
 *
 * Each experiment modifies one parameter at a time (OAT strategy).
 * Experiments are ordered by parameter priority (most impactful first).
 */

import type { BotConfig } from "@outprep/engine";
import { generateAllVariants } from "../util/config-perturbation";
import type { ExperimentSpec, SweepPlan, DatasetRef } from "../state/types";

export interface PlanOptions {
  /** Max total experiments to generate */
  maxExperiments: number;
  /** Positions to evaluate in triage runs */
  triagePositions: number;
  /** Base random seed (each experiment gets seed + index) */
  baseSeed: number;
}

/**
 * Generate a sweep plan from the current best config and available datasets.
 */
export function createSweepPlan(
  bestConfig: BotConfig,
  datasets: DatasetRef[],
  options: PlanOptions
): SweepPlan {
  const variants = generateAllVariants(bestConfig, options.maxExperiments);
  const datasetNames = datasets.map((d) => d.name);

  const experiments: ExperimentSpec[] = variants.map((variant, index) => ({
    id: `sweep-${String(index).padStart(3, "0")}-${variant.label.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 40)}`,
    parameter: variant.parameter,
    description: variant.description,
    configOverride: variant.override,
    datasets: datasetNames,
    maxPositions: options.triagePositions,
    seed: options.baseSeed,  // same seed as baseline → same positions → apples-to-apples comparison
    status: "pending" as const,
  }));

  return {
    baseConfig: bestConfig,
    baselineLabel: "baseline",
    experiments,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
}

/**
 * Get the next pending experiment from a sweep plan.
 */
export function getNextExperiment(plan: SweepPlan): ExperimentSpec | null {
  return plan.experiments.find((e) => e.status === "pending") ?? null;
}

/**
 * Get experiments that passed triage and should be promoted to full runs.
 */
export function getPromotableExperiments(
  plan: SweepPlan,
  baselineScore: number,
  topN: number = 5
): ExperimentSpec[] {
  return plan.experiments
    .filter((e) => e.status === "complete" && e.triageScore != null && e.triageScore > baselineScore)
    .sort((a, b) => (b.triageScore ?? 0) - (a.triageScore ?? 0))
    .slice(0, topN);
}

/**
 * Check if all experiments in the plan are done (complete or skipped).
 */
export function isPlanComplete(plan: SweepPlan): boolean {
  return plan.experiments.every(
    (e) => e.status === "complete" || e.status === "skipped"
  );
}

/**
 * Summary of plan progress.
 */
export function planProgress(plan: SweepPlan): {
  total: number;
  complete: number;
  pending: number;
  running: number;
  skipped: number;
} {
  const total = plan.experiments.length;
  const complete = plan.experiments.filter((e) => e.status === "complete").length;
  const pending = plan.experiments.filter((e) => e.status === "pending").length;
  const running = plan.experiments.filter((e) => e.status === "running" || e.status === "triage").length;
  const skipped = plan.experiments.filter((e) => e.status === "skipped").length;
  return { total, complete, pending, running, skipped };
}

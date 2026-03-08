/**
 * Convergence detection for the autonomous agent loop.
 *
 * Determines when to stop iterating based on:
 * 1. Metric plateau (no improvement in N experiments)
 * 2. Max experiments reached
 * 3. Cost budget exceeded
 * 4. Regression detected (metrics getting worse)
 */

import type { ExperimentRecord } from "../state/types";
import type { CostSnapshot } from "./cost-tracker";

export interface ConvergenceConfig {
  /** Max experiments before stopping */
  maxExperiments: number;
  /** Stop after this many experiments without improvement */
  plateauThreshold: number;
  /** Max API cost in USD */
  maxCostUsd: number;
  /** Stop if composite score drops below this vs baseline */
  regressionThreshold: number;
}

export const DEFAULT_CONVERGENCE: ConvergenceConfig = {
  maxExperiments: 20,
  plateauThreshold: 5,
  maxCostUsd: 10.0,
  regressionThreshold: -0.05,
};

export interface ConvergenceResult {
  shouldStop: boolean;
  reason: string | null;
  experimentCount: number;
  sinceLastImprovement: number;
}

/**
 * Check if the agent loop should stop.
 */
export function checkConvergence(
  experiments: ExperimentRecord[],
  cost: CostSnapshot,
  config: ConvergenceConfig
): ConvergenceResult {
  const experimentCount = experiments.length;

  // Check max experiments
  if (experimentCount >= config.maxExperiments) {
    return {
      shouldStop: true,
      reason: `Max experiments reached (${config.maxExperiments})`,
      experimentCount,
      sinceLastImprovement: 0,
    };
  }

  // Check cost budget
  if (cost.estimatedCostUsd > config.maxCostUsd) {
    return {
      shouldStop: true,
      reason: `Cost budget exceeded ($${cost.estimatedCostUsd.toFixed(2)} > $${config.maxCostUsd.toFixed(2)})`,
      experimentCount,
      sinceLastImprovement: 0,
    };
  }

  if (experimentCount < 2) {
    return {
      shouldStop: false,
      reason: null,
      experimentCount,
      sinceLastImprovement: 0,
    };
  }

  // Check plateau
  let bestComposite = -Infinity;
  let bestExperimentNumber = 0;

  for (const exp of experiments) {
    if (exp.result.compositeScore > bestComposite) {
      bestComposite = exp.result.compositeScore;
      bestExperimentNumber = exp.number;
    }
  }

  const currentNumber = experiments[experiments.length - 1].number;
  const sinceLastImprovement = currentNumber - bestExperimentNumber;

  if (sinceLastImprovement >= config.plateauThreshold) {
    return {
      shouldStop: true,
      reason: `Plateau detected: no improvement in ${sinceLastImprovement} experiments`,
      experimentCount,
      sinceLastImprovement,
    };
  }

  // Check regression (last 3 experiments all worse than first)
  if (experimentCount >= 4) {
    const baselineScore = experiments[0].result.compositeScore;
    const last3 = experiments.slice(-3);
    const allRegressed = last3.every(
      (e) =>
        e.result.compositeScore - baselineScore < config.regressionThreshold
    );

    if (allRegressed) {
      return {
        shouldStop: true,
        reason: `Regression detected: last 3 experiments all below baseline by >${Math.abs(config.regressionThreshold)}`,
        experimentCount,
        sinceLastImprovement,
      };
    }
  }

  return {
    shouldStop: false,
    reason: null,
    experimentCount,
    sinceLastImprovement,
  };
}

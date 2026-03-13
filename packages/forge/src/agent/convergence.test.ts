import { describe, it, expect } from "vitest";
import {
  checkConvergence,
  DEFAULT_CONVERGENCE,
  type ConvergenceConfig,
} from "./convergence";
import type { ExperimentRecord } from "../state/types";
import type { CostSnapshot } from "./cost-tracker";

/* ── Helpers ─────────────────────────────────────────────── */

function makeCost(usd = 0): CostSnapshot {
  return { inputTokens: 0, outputTokens: 0, estimatedCostUsd: usd, apiCalls: 0 };
}

function makeExperiment(number: number, compositeScore: number): ExperimentRecord {
  return {
    id: `exp-${number}`,
    sessionId: "session-1",
    number,
    timestamp: new Date().toISOString(),
    hypothesis: "test",
    category: "parameter",
    codeChanges: [],
    configChanges: [],
    players: [],
    positionsEvaluated: 100,
    evaluationDurationMs: 1000,
    result: {
      moveAccuracy: 0.5,
      moveAccuracyByPhase: { opening: 0.5, middlegame: 0.5, endgame: 0.5, overall: 0.5 },
      cplKLDivergence: 0.1,
      cplKSStatistic: 0.1,
      cplKSPValue: 0.5,
      cplByPhase: {},
      blunderRateDelta: { opening: 0, middlegame: 0, endgame: 0, overall: 0 },
      mistakeRateDelta: { opening: 0, middlegame: 0, endgame: 0, overall: 0 },
      compositeScore,
      rawMetrics: {} as any,
      positionsEvaluated: 100,
    },
    delta: { moveAccuracy: 0, cplKLDivergence: 0, blunderRateDelta: 0, compositeScore: 0 },
    significance: [],
    conclusion: "inconclusive",
    notes: "",
    nextSteps: [],
  };
}

const config: ConvergenceConfig = { ...DEFAULT_CONVERGENCE };

/* ── Tests ───────────────────────────────────────────────── */

describe("checkConvergence", () => {
  it("does not converge with 0 experiments", () => {
    const result = checkConvergence([], makeCost(0), config);
    expect(result.shouldStop).toBe(false);
    expect(result.experimentCount).toBe(0);
  });

  it("does not converge with 1 experiment (< 2)", () => {
    const result = checkConvergence([makeExperiment(1, 0.5)], makeCost(0), config);
    expect(result.shouldStop).toBe(false);
    expect(result.experimentCount).toBe(1);
  });

  it("converges when max experiments reached", () => {
    const experiments = Array.from({ length: 20 }, (_, i) =>
      makeExperiment(i + 1, 0.5 + i * 0.01)
    );
    const result = checkConvergence(experiments, makeCost(0), config);
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toContain("Max experiments");
  });

  it("converges when cost budget exceeded", () => {
    const experiments = [makeExperiment(1, 0.5), makeExperiment(2, 0.55)];
    const result = checkConvergence(experiments, makeCost(15.0), config);
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toContain("Cost budget exceeded");
  });

  it("converges on plateau (no improvement in N experiments)", () => {
    // Best at experiment 1, then 5 experiments with no improvement
    const experiments = [
      makeExperiment(1, 0.8),
      makeExperiment(2, 0.7),
      makeExperiment(3, 0.7),
      makeExperiment(4, 0.7),
      makeExperiment(5, 0.7),
      makeExperiment(6, 0.7),
    ];
    const result = checkConvergence(experiments, makeCost(0), config);
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toContain("Plateau");
    expect(result.sinceLastImprovement).toBe(5);
  });

  it("converges on regression (last 3 below baseline by threshold)", () => {
    // Baseline at 0.5, then last 3 all drop below 0.5 - 0.05 = 0.45
    const experiments = [
      makeExperiment(1, 0.5),
      makeExperiment(2, 0.52),
      makeExperiment(3, 0.40),
      makeExperiment(4, 0.38),
      makeExperiment(5, 0.35),
    ];
    const result = checkConvergence(experiments, makeCost(0), config);
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toContain("Regression");
  });

  it("does not flag regression if < 4 experiments", () => {
    const experiments = [
      makeExperiment(1, 0.5),
      makeExperiment(2, 0.3),
      makeExperiment(3, 0.3),
    ];
    const result = checkConvergence(experiments, makeCost(0), config);
    // Not enough experiments for regression check, and no plateau yet
    expect(result.shouldStop).toBe(false);
  });

  it("does not converge with active improvement", () => {
    const experiments = [
      makeExperiment(1, 0.5),
      makeExperiment(2, 0.55),
      makeExperiment(3, 0.58),
      makeExperiment(4, 0.60),
      makeExperiment(5, 0.63),
    ];
    const result = checkConvergence(experiments, makeCost(1.0), config);
    expect(result.shouldStop).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("respects custom config values", () => {
    const customConfig: ConvergenceConfig = {
      maxExperiments: 5,
      plateauThreshold: 2,
      maxCostUsd: 1.0,
      regressionThreshold: -0.01,
    };
    const experiments = Array.from({ length: 5 }, (_, i) =>
      makeExperiment(i + 1, 0.5)
    );
    const result = checkConvergence(experiments, makeCost(0), customConfig);
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toContain("Max experiments");
  });
});

/**
 * Structured experiment recording.
 *
 * Each experiment in a forge session produces a record capturing
 * the hypothesis, changes, results, and conclusions. These records
 * are used both for the agent's decision-making and for human review.
 */

import type {
  ExperimentRecord,
  MaiaMetrics,
  MaiaMetricsDelta,
  CodeChange,
  ConfigChangeRecord,
  SignificanceResult,
} from "../state/types";
import { randomUUID } from "node:crypto";

/**
 * Create a new experiment record.
 */
export function createExperiment(opts: {
  sessionId: string;
  number: number;
  hypothesis: string;
  category: ExperimentRecord["category"];
  codeChanges: CodeChange[];
  configChanges: ConfigChangeRecord[];
  players: string[];
}): ExperimentRecord {
  return {
    id: randomUUID(),
    sessionId: opts.sessionId,
    number: opts.number,
    timestamp: new Date().toISOString(),
    hypothesis: opts.hypothesis,
    category: opts.category,
    codeChanges: opts.codeChanges,
    configChanges: opts.configChanges,
    players: opts.players,
    positionsEvaluated: 0,
    evaluationDurationMs: 0,
    result: emptyMaiaMetrics(),
    delta: emptyDelta(),
    significance: [],
    conclusion: "inconclusive",
    notes: "",
    nextSteps: [],
  };
}

/**
 * Finalize an experiment with results.
 */
export function finalizeExperiment(
  experiment: ExperimentRecord,
  result: MaiaMetrics,
  baseline: MaiaMetrics,
  significance: SignificanceResult[],
  opts: {
    positionsEvaluated: number;
    evaluationDurationMs: number;
    conclusion: ExperimentRecord["conclusion"];
    notes: string;
    nextSteps: string[];
    oracleQueryId?: string;
  }
): void {
  experiment.result = result;
  experiment.delta = computeDelta(baseline, result);
  experiment.significance = significance;
  experiment.positionsEvaluated = opts.positionsEvaluated;
  experiment.evaluationDurationMs = opts.evaluationDurationMs;
  experiment.conclusion = opts.conclusion;
  experiment.notes = opts.notes;
  experiment.nextSteps = opts.nextSteps;
  experiment.oracleQueryId = opts.oracleQueryId;
}

function computeDelta(baseline: MaiaMetrics, result: MaiaMetrics): MaiaMetricsDelta {
  return {
    moveAccuracy: result.moveAccuracy - baseline.moveAccuracy,
    cplKLDivergence: result.cplKLDivergence - baseline.cplKLDivergence,
    blunderRateDelta: result.blunderRateDelta.overall - baseline.blunderRateDelta.overall,
    compositeScore: result.compositeScore - baseline.compositeScore,
  };
}

function emptyMaiaMetrics(): MaiaMetrics {
  const emptyPhase = { opening: 0, middlegame: 0, endgame: 0, overall: 0 };
  return {
    moveAccuracy: 0,
    moveAccuracyByPhase: { ...emptyPhase },
    cplKLDivergence: 0,
    cplKSStatistic: 0,
    cplKSPValue: 0,
    cplByPhase: {},
    blunderRateDelta: { ...emptyPhase },
    mistakeRateDelta: { ...emptyPhase },
    compositeScore: 0,
    rawMetrics: {
      totalPositions: 0,
      matchRate: 0,
      topNRate: 0,
      bookCoverage: 0,
      avgActualCPL: NaN,
      avgBotCPL: NaN,
      cplDelta: NaN,
      byPhase: {
        opening: { positions: 0, matchRate: 0, topNRate: 0, avgCPL: NaN, botAvgCPL: NaN },
        middlegame: { positions: 0, matchRate: 0, topNRate: 0, avgCPL: NaN, botAvgCPL: NaN },
        endgame: { positions: 0, matchRate: 0, topNRate: 0, avgCPL: NaN, botAvgCPL: NaN },
      },
    },
    positionsEvaluated: 0,
  };
}

function emptyDelta(): MaiaMetricsDelta {
  return {
    moveAccuracy: 0,
    cplKLDivergence: 0,
    blunderRateDelta: 0,
    compositeScore: 0,
  };
}

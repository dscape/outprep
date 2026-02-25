/**
 * Result aggregator — combines per-dataset results into a single
 * aggregated metric set for an experiment.
 *
 * Averages metrics across datasets, weighted by position count.
 */

import type { Metrics, TestResult } from "@outprep/harness";
import { compositeScore } from "../scoring/composite-score";
import type { AggregatedResult, DatasetRef } from "../state/types";

/**
 * Average multiple Metrics objects, weighted by position count.
 */
export function averageMetrics(
  results: { metrics: Metrics; weight: number }[]
): Metrics {
  const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
  if (totalWeight === 0) {
    return {
      totalPositions: 0,
      matchRate: 0,
      topNRate: 0,
      bookCoverage: 0,
      avgActualCPL: 0,
      avgBotCPL: 0,
      cplDelta: 0,
      byPhase: {
        opening: { positions: 0, matchRate: 0, topNRate: 0, avgCPL: 0, botAvgCPL: 0 },
        middlegame: { positions: 0, matchRate: 0, topNRate: 0, avgCPL: 0, botAvgCPL: 0 },
        endgame: { positions: 0, matchRate: 0, topNRate: 0, avgCPL: 0, botAvgCPL: 0 },
      },
    };
  }

  const avg = (fn: (m: Metrics) => number) =>
    results.reduce((sum, r) => sum + fn(r.metrics) * r.weight, 0) / totalWeight;

  const totalPositions = results.reduce((sum, r) => sum + r.metrics.totalPositions, 0);

  return {
    totalPositions,
    matchRate: avg((m) => m.matchRate),
    topNRate: avg((m) => m.topNRate),
    bookCoverage: avg((m) => m.bookCoverage),
    avgActualCPL: avg((m) => m.avgActualCPL),
    avgBotCPL: avg((m) => m.avgBotCPL),
    cplDelta: avg((m) => m.cplDelta),
    byPhase: {
      opening: {
        positions: results.reduce((s, r) => s + r.metrics.byPhase.opening.positions, 0),
        matchRate: avg((m) => m.byPhase.opening.matchRate),
        topNRate: avg((m) => m.byPhase.opening.topNRate),
        avgCPL: avg((m) => m.byPhase.opening.avgCPL),
        botAvgCPL: avg((m) => m.byPhase.opening.botAvgCPL),
      },
      middlegame: {
        positions: results.reduce((s, r) => s + r.metrics.byPhase.middlegame.positions, 0),
        matchRate: avg((m) => m.byPhase.middlegame.matchRate),
        topNRate: avg((m) => m.byPhase.middlegame.topNRate),
        avgCPL: avg((m) => m.byPhase.middlegame.avgCPL),
        botAvgCPL: avg((m) => m.byPhase.middlegame.botAvgCPL),
      },
      endgame: {
        positions: results.reduce((s, r) => s + r.metrics.byPhase.endgame.positions, 0),
        matchRate: avg((m) => m.byPhase.endgame.matchRate),
        topNRate: avg((m) => m.byPhase.endgame.topNRate),
        avgCPL: avg((m) => m.byPhase.endgame.avgCPL),
        botAvgCPL: avg((m) => m.byPhase.endgame.botAvgCPL),
      },
    },
  };
}

/**
 * Aggregate test results for one experiment across multiple datasets.
 */
export function aggregateExperimentResults(
  experimentId: string,
  parameter: string,
  description: string,
  configOverride: Record<string, unknown>,
  results: { dataset: DatasetRef; result: TestResult }[],
  baselineScore: number
): AggregatedResult {
  const datasetMetrics = results.map(({ dataset, result }) => ({
    dataset: dataset.name,
    elo: dataset.elo,
    metrics: result.metrics,
  }));

  const aggregatedMetrics = averageMetrics(
    results.map(({ result }) => ({
      metrics: result.metrics,
      weight: result.metrics.totalPositions,
    }))
  );

  const score = compositeScore(aggregatedMetrics);

  return {
    experimentId,
    parameter,
    description,
    configOverride,
    datasetMetrics,
    aggregatedMetrics,
    compositeScore: score,
    scoreDelta: score - baselineScore,
  };
}

/**
 * Composite Maia-aligned scorer.
 *
 * Combines move accuracy, CPL distribution match, and blunder profile
 * into a single weighted score for experiment comparison.
 *
 * Weights:
 *   50% — Move prediction accuracy (primary Maia metric)
 *   20% — CPL distribution match (distribution shape, not just mean)
 *   15% — Blunder rate match (phase-specific error profile)
 *   15% — Other (book personality + think time, stub for now)
 */

import type { PositionResult, TestResult, Metrics } from "@outprep/harness";
import type { MaiaMetrics, BaselineSnapshot, PlayerMetricSnapshot } from "../state/types";
import { computeMoveAccuracy } from "./move-accuracy";
import { computeCPLDistribution } from "./cpl-distribution";
import { computeBlunderProfile } from "./blunder-profile";

const WEIGHTS = {
  moveAccuracy: 0.50,
  cplDistribution: 0.20,
  blunderProfile: 0.15,
  other: 0.15,
};

/**
 * Compute full Maia-aligned metrics from position-level results.
 */
export function computeMaiaMetrics(
  positions: PositionResult[],
  rawMetrics: Metrics,
  opts: { seed?: number } = {}
): MaiaMetrics {
  const accuracy = computeMoveAccuracy(positions, opts);
  const cpl = computeCPLDistribution(positions);
  const blunders = computeBlunderProfile(positions);

  // Composite score: higher = better
  // Accuracy: directly (0-1, higher = better)
  // CPL KL divergence: invert (lower KL = better match, cap at 1.0)
  // Blunder rate delta: invert (lower delta = better match, cap at 1.0)
  const cplScore = Math.max(0, 1 - cpl.klDivergence); // 0 KL → 1.0 score
  const blunderScore = Math.max(
    0,
    1 - blunders.blunderRateDelta.overall * 10 // scale: 0.1 delta → 0 score
  );
  const otherScore = rawMetrics.bookCoverage; // stub: book personality

  const compositeScore =
    WEIGHTS.moveAccuracy * accuracy.overall +
    WEIGHTS.cplDistribution * cplScore +
    WEIGHTS.blunderProfile * blunderScore +
    WEIGHTS.other * otherScore;

  return {
    moveAccuracy: accuracy.overall,
    moveAccuracyByPhase: accuracy.byPhase,

    cplKLDivergence: cpl.klDivergence,
    cplKSStatistic: cpl.ksStatistic,
    cplKSPValue: cpl.ksPValue,
    cplByPhase: cpl.byPhase,

    blunderRateDelta: blunders.blunderRateDelta,
    mistakeRateDelta: blunders.mistakeRateDelta,

    compositeScore,
    rawMetrics,
    positionsEvaluated: positions.length,
  };
}

/**
 * Compute a baseline snapshot for one or more players.
 *
 * This is called at the start of a research session to establish
 * the starting point for comparison.
 */
export async function computeBaseline(
  players: string[],
  opts: { seed?: number; maxPositions?: number } = {}
): Promise<BaselineSnapshot> {
  // Lazy import to avoid circular dependency and loading heavy modules at startup
  const { fetchPlayer, getGames } = await import("../data/game-store");
  const { createSplit } = await import("../data/splits");
  const { NodeStockfishAdapter, runAccuracyTest, computeMetrics } = await import("@outprep/harness");
  const { DEFAULT_CONFIG } = await import("@outprep/engine");

  const engine = new NodeStockfishAdapter();
  await engine.init();

  const playerMetrics: PlayerMetricSnapshot[] = [];
  const splitHashes: Record<string, string> = {};

  try {
    for (const username of players) {
      console.log(`  Evaluating baseline for ${username}...`);

      // Load player data (download if not cached)
      const playerData = await fetchPlayer(username);
      const games = getGames(username);

      // Split into train/test
      const { testGames, split } = createSplit(games, {
        seed: opts.seed ?? 42,
        trainRatio: 0.8,
      });
      splitHashes[username] = split.splitHash;

      // Run harness evaluation on test set
      const dataset = {
        name: username,
        username,
        estimatedElo: playerData.estimatedElo,
        speeds: [] as string[],
        createdAt: new Date().toISOString(),
        gameCount: testGames.length,
        gamesWithEvals: 0,
        games: testGames,
      };

      const result = await runAccuracyTest(engine, dataset, {
        seed: opts.seed ?? 42,
        label: "baseline",
        maxPositions: opts.maxPositions ?? 200,
        phaseBalanced: true,
        skipTopN: false,
      });

      const maiaMetrics = computeMaiaMetrics(
        result.positions,
        result.metrics,
        opts
      );

      playerMetrics.push({
        username,
        elo: playerData.estimatedElo,
        metrics: maiaMetrics,
        positionsEvaluated: result.positions.length,
      });
    }

    // Aggregate across players
    const aggregate = aggregateMetrics(playerMetrics);

    return {
      timestamp: new Date().toISOString(),
      config: DEFAULT_CONFIG,
      playerMetrics,
      aggregate,
      splitHashes,
    };
  } finally {
    engine.dispose();
  }
}

/**
 * Aggregate MaiaMetrics across multiple players.
 * Uses weighted average by positions evaluated.
 */
function aggregateMetrics(snapshots: PlayerMetricSnapshot[]): MaiaMetrics {
  if (snapshots.length === 0) {
    throw new Error("Cannot aggregate zero player metrics");
  }

  const totalPositions = snapshots.reduce(
    (s, p) => s + p.positionsEvaluated,
    0
  );

  // Weighted average helper
  const wavg = (getter: (m: MaiaMetrics) => number) => {
    return (
      snapshots.reduce(
        (s, p) => s + getter(p.metrics) * p.positionsEvaluated,
        0
      ) / totalPositions
    );
  };

  return {
    moveAccuracy: wavg((m) => m.moveAccuracy),
    moveAccuracyByPhase: {
      opening: wavg((m) => m.moveAccuracyByPhase.opening),
      middlegame: wavg((m) => m.moveAccuracyByPhase.middlegame),
      endgame: wavg((m) => m.moveAccuracyByPhase.endgame),
      overall: wavg((m) => m.moveAccuracyByPhase.overall),
    },
    cplKLDivergence: wavg((m) => m.cplKLDivergence),
    cplKSStatistic: wavg((m) => m.cplKSStatistic),
    cplKSPValue: wavg((m) => m.cplKSPValue),
    cplByPhase: snapshots[0].metrics.cplByPhase, // Use first player's (approximation)
    blunderRateDelta: {
      opening: wavg((m) => m.blunderRateDelta.opening),
      middlegame: wavg((m) => m.blunderRateDelta.middlegame),
      endgame: wavg((m) => m.blunderRateDelta.endgame),
      overall: wavg((m) => m.blunderRateDelta.overall),
    },
    mistakeRateDelta: {
      opening: wavg((m) => m.mistakeRateDelta.opening),
      middlegame: wavg((m) => m.mistakeRateDelta.middlegame),
      endgame: wavg((m) => m.mistakeRateDelta.endgame),
      overall: wavg((m) => m.mistakeRateDelta.overall),
    },
    compositeScore: wavg((m) => m.compositeScore),
    rawMetrics: snapshots[0].metrics.rawMetrics, // Use first player's (approximation)
    positionsEvaluated: totalPositions,
  };
}

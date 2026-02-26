/**
 * Compute aggregate metrics from position-level results.
 */

import type { GamePhase } from "@outprep/engine";
import type { PositionResult, Metrics, PhaseMetrics } from "./types";

export function computeMetrics(positions: PositionResult[]): Metrics {
  const total = positions.length;
  if (total === 0) {
    const emptyPhase: PhaseMetrics = {
      positions: 0,
      matchRate: 0,
      topNRate: 0,
      avgCPL: NaN,
      botAvgCPL: NaN,
    };
    return {
      totalPositions: 0,
      matchRate: 0,
      topNRate: 0,
      bookCoverage: 0,
      avgActualCPL: NaN,
      avgBotCPL: NaN,
      cplDelta: NaN,
      byPhase: {
        opening: { ...emptyPhase },
        middlegame: { ...emptyPhase },
        endgame: { ...emptyPhase },
      },
    };
  }

  const matches = positions.filter((p) => p.isMatch).length;
  const topN = positions.filter((p) => p.isInTopN).length;
  const bookPositions = positions.filter((p) => p.botSource === "book").length;

  // CPL computation (only for positions with eval data)
  const withActualCPL = positions.filter((p) => p.actualCPL !== undefined);
  const avgActualCPL =
    withActualCPL.length > 0
      ? withActualCPL.reduce((sum, p) => sum + (p.actualCPL ?? 0), 0) /
        withActualCPL.length
      : NaN;   // No data → NaN (not 0, which would mean "perfect play")

  const withBotCPL = positions.filter((p) => p.botCPL !== undefined);
  const avgBotCPL =
    withBotCPL.length > 0
      ? withBotCPL.reduce((sum, p) => sum + (p.botCPL ?? 0), 0) /
        withBotCPL.length
      : NaN;   // No data → NaN (not 0, which would mean "perfect play")

  // Per-phase metrics
  const phases: GamePhase[] = ["opening", "middlegame", "endgame"];
  const byPhase = {} as Record<GamePhase, PhaseMetrics>;

  for (const phase of phases) {
    const pp = positions.filter((p) => p.phase === phase);
    const ppWithActualCPL = pp.filter((p) => p.actualCPL !== undefined);
    const ppWithBotCPL = pp.filter((p) => p.botCPL !== undefined);

    byPhase[phase] = {
      positions: pp.length,
      matchRate: pp.length > 0 ? pp.filter((p) => p.isMatch).length / pp.length : 0,
      topNRate: pp.length > 0 ? pp.filter((p) => p.isInTopN).length / pp.length : 0,
      avgCPL:
        ppWithActualCPL.length > 0
          ? ppWithActualCPL.reduce((sum, p) => sum + (p.actualCPL ?? 0), 0) /
            ppWithActualCPL.length
          : NaN,
      botAvgCPL:
        ppWithBotCPL.length > 0
          ? ppWithBotCPL.reduce((sum, p) => sum + (p.botCPL ?? 0), 0) /
            ppWithBotCPL.length
          : NaN,
    };
  }

  return {
    totalPositions: total,
    matchRate: matches / total,
    topNRate: topN / total,
    bookCoverage: bookPositions / total,
    avgActualCPL,
    avgBotCPL,
    cplDelta: (isNaN(avgBotCPL) || isNaN(avgActualCPL))
      ? NaN
      : Math.abs(avgBotCPL - avgActualCPL),
    byPhase,
  };
}

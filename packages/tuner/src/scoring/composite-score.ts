/**
 * Composite scoring function — combines multiple metrics into a single
 * scalar for ranking config variants.
 *
 * Weights are configurable but sensible defaults prioritize:
 * - Match rate (30%): Did the bot pick the same move as the player?
 * - Top-N rate (25%): Was the player's move in the top 4 candidates?
 * - CPL delta (25%): Does the bot's error pattern match the player's?
 * - Book coverage (10%): Opening personality preservation
 * - CPL similarity (10%): Absolute CPL proximity
 */

import type { Metrics } from "@outprep/harness";

export interface ScoreWeights {
  matchRate: number;
  topNRate: number;
  cplDelta: number;
  bookCoverage: number;
  cplSimilarity: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  matchRate: 0.30,
  topNRate: 0.25,
  cplDelta: 0.25,
  bookCoverage: 0.10,
  cplSimilarity: 0.10,
};

/**
 * Compute a composite score from metrics. Higher = better.
 * Returns a value in [0, 1].
 *
 * When CPL data is unavailable (NaN — e.g. triage mode where botCPL
 * can't be reliably measured), the cplDelta and cplSimilarity weights
 * are redistributed proportionally to the remaining components.
 */
export function compositeScore(
  metrics: Metrics,
  weights: ScoreWeights = DEFAULT_WEIGHTS
): number {
  const hasCPL = !isNaN(metrics.cplDelta) && !isNaN(metrics.avgBotCPL);

  if (!hasCPL) {
    // No CPL data — score from matchRate, topNRate, bookCoverage only.
    // Redistribute CPL weight proportionally so result stays in [0, 1].
    const activeWeight = weights.matchRate + weights.topNRate + weights.bookCoverage;
    if (activeWeight === 0) return 0;
    return (
      weights.matchRate * metrics.matchRate +
      weights.topNRate * metrics.topNRate +
      weights.bookCoverage * metrics.bookCoverage
    ) / activeWeight;
  }

  // Full scoring with CPL data
  // Normalize cplDelta: 0 → 1.0, 50+ → 0.0
  const cplDeltaNorm = 1 - Math.min(1, metrics.cplDelta / 50);

  // Normalize CPL similarity: |botCPL - actualCPL| → 0 is perfect
  const cplSimilarity =
    1 - Math.min(1, Math.abs(metrics.avgBotCPL - metrics.avgActualCPL) / 30);

  return (
    weights.matchRate * metrics.matchRate +
    weights.topNRate * metrics.topNRate +
    weights.cplDelta * cplDeltaNorm +
    weights.bookCoverage * metrics.bookCoverage +
    weights.cplSimilarity * cplSimilarity
  );
}

/**
 * Format a composite score as a percentage string.
 */
export function formatScore(score: number): string {
  return (score * 100).toFixed(1) + "%";
}

/**
 * Format a score delta with sign.
 */
export function formatDelta(delta: number): string {
  const sign = delta >= 0 ? "+" : "";
  return sign + (delta * 100).toFixed(2) + "%";
}

/**
 * Format the strength calibration difference between bot and player.
 * Positive delta (actualCPL > botCPL) = bot is stronger than the player.
 * Negative delta (actualCPL < botCPL) = bot is weaker than the player.
 */
export function formatStrength(actualCPL: number, botCPL: number): string {
  if (isNaN(actualCPL) || isNaN(botCPL)) return "CPL N/A (triage)";
  const delta = actualCPL - botCPL;
  if (Math.abs(delta) < 2) return "≈ calibrated";
  if (delta > 0) return `${delta.toFixed(0)}cp too strong`;
  return `${Math.abs(delta).toFixed(0)}cp too weak`;
}

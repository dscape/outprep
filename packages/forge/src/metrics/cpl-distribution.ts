/**
 * CPL distribution matching — goes beyond mean CPL delta.
 *
 * Instead of comparing just mean CPL (which loses information about
 * the shape of errors), matches the full CPL distribution using:
 *
 * 1. KL Divergence: measures how different the bot's CPL histogram
 *    is from the player's. Lower = better match.
 *
 * 2. Kolmogorov-Smirnov statistic: maximum difference between the
 *    two cumulative distribution functions. Lower = better match.
 *
 * CPL bins: [0-10, 10-25, 25-50, 50-100, 100-200, 200-300, 300+]
 * These bins reflect chess-meaningful error ranges:
 *   0-10cp: near-perfect play
 *   10-25cp: minor inaccuracy
 *   25-50cp: inaccuracy
 *   50-100cp: clear mistake
 *   100-200cp: serious mistake
 *   200-300cp: borderline blunder
 *   300+cp: blunder
 */

import type { PositionResult } from "@outprep/harness";
import type { GamePhase } from "@outprep/engine";

const CPL_BIN_EDGES = [0, 10, 25, 50, 100, 200, 300, Infinity];
const CPL_BIN_LABELS = ["0-10", "10-25", "25-50", "50-100", "100-200", "200-300", "300+"];

export interface CPLDistributionResult {
  /** KL divergence from player to bot distribution (lower = better) */
  klDivergence: number;
  /** Kolmogorov-Smirnov statistic (lower = better) */
  ksStatistic: number;
  /** KS test p-value (approximate) */
  ksPValue: number;
  /** Bot CPL histogram (normalized frequencies per bin) */
  botHistogram: number[];
  /** Player CPL histogram (normalized frequencies per bin) */
  playerHistogram: number[];
  /** Bin labels */
  binLabels: string[];
  /** Per-phase distributions */
  byPhase: Record<string, { klDivergence: number; ksStatistic: number }>;
}

/**
 * Bin CPL values into a histogram.
 * Returns normalized frequencies (sum = 1).
 */
function binCPL(values: number[]): number[] {
  const counts = new Array(CPL_BIN_EDGES.length - 1).fill(0);

  for (const v of values) {
    for (let i = 0; i < CPL_BIN_EDGES.length - 1; i++) {
      if (v >= CPL_BIN_EDGES[i] && v < CPL_BIN_EDGES[i + 1]) {
        counts[i]++;
        break;
      }
    }
  }

  const total = values.length || 1;
  return counts.map((c) => c / total);
}

/**
 * KL divergence: D_KL(P || Q) where P = player, Q = bot.
 *
 * Uses Laplace smoothing (add 1/N to each bin) to avoid log(0).
 */
function klDivergence(p: number[], q: number[]): number {
  const eps = 1e-10; // smoothing
  let kl = 0;

  for (let i = 0; i < p.length; i++) {
    const pi = p[i] + eps;
    const qi = q[i] + eps;
    kl += pi * Math.log(pi / qi);
  }

  return kl;
}

/**
 * Kolmogorov-Smirnov statistic between two samples.
 * Returns the maximum absolute difference between the two CDFs.
 */
function ksStatistic(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 1.0;

  const combined = [
    ...a.map((v) => ({ v, source: "a" as const })),
    ...b.map((v) => ({ v, source: "b" as const })),
  ].sort((x, y) => x.v - y.v);

  let cdfA = 0;
  let cdfB = 0;
  let maxDiff = 0;

  for (const item of combined) {
    if (item.source === "a") {
      cdfA += 1 / a.length;
    } else {
      cdfB += 1 / b.length;
    }
    maxDiff = Math.max(maxDiff, Math.abs(cdfA - cdfB));
  }

  return maxDiff;
}

/**
 * Approximate p-value for the KS statistic.
 * Uses the asymptotic formula: P ≈ 2 * exp(-2 * n_eff * D^2)
 * where n_eff = (n1 * n2) / (n1 + n2).
 */
function ksPValue(d: number, n1: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 1.0;
  const nEff = (n1 * n2) / (n1 + n2);
  return Math.min(1, 2 * Math.exp(-2 * nEff * d * d));
}

/**
 * Compute CPL distribution match between bot and player.
 */
export function computeCPLDistribution(
  positions: PositionResult[]
): CPLDistributionResult {
  // Extract CPL values
  const botCPLs = positions
    .filter((p) => p.botCPL !== undefined)
    .map((p) => p.botCPL!);
  const playerCPLs = positions
    .filter((p) => p.actualCPL !== undefined)
    .map((p) => p.actualCPL!);

  // Bin into histograms
  const botHistogram = binCPL(botCPLs);
  const playerHistogram = binCPL(playerCPLs);

  // KL divergence
  const kl = klDivergence(playerHistogram, botHistogram);

  // KS test
  const ks = ksStatistic(playerCPLs, botCPLs);
  const pValue = ksPValue(ks, playerCPLs.length, botCPLs.length);

  // Per-phase distributions
  const phases: GamePhase[] = ["opening", "middlegame", "endgame"];
  const byPhase: Record<string, { klDivergence: number; ksStatistic: number }> = {};

  for (const phase of phases) {
    const phasePositions = positions.filter((p) => p.phase === phase);
    const phaseBotCPLs = phasePositions
      .filter((p) => p.botCPL !== undefined)
      .map((p) => p.botCPL!);
    const phasePlayerCPLs = phasePositions
      .filter((p) => p.actualCPL !== undefined)
      .map((p) => p.actualCPL!);

    if (phaseBotCPLs.length === 0 || phasePlayerCPLs.length === 0) {
      byPhase[phase] = { klDivergence: NaN, ksStatistic: NaN };
      continue;
    }

    const phaseBotHist = binCPL(phaseBotCPLs);
    const phasePlayerHist = binCPL(phasePlayerCPLs);

    byPhase[phase] = {
      klDivergence: klDivergence(phasePlayerHist, phaseBotHist),
      ksStatistic: ksStatistic(phasePlayerCPLs, phaseBotCPLs),
    };
  }

  return {
    klDivergence: kl,
    ksStatistic: ks,
    ksPValue: pValue,
    botHistogram,
    playerHistogram,
    binLabels: CPL_BIN_LABELS,
    byPhase,
  };
}

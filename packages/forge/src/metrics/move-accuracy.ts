/**
 * Move prediction accuracy — Maia-aligned top-1 match rate.
 *
 * Key difference from harness matchRate: operates on a held-out test set.
 * The player profile (error profile, opening trie, style) is built from
 * the train set only. Accuracy is measured on the test set.
 *
 * This prevents information leakage, especially through the opening trie
 * (where the bot would "know" the player's exact opening moves because
 * it learned from the same games it's evaluated against).
 */

import type { PositionResult } from "@outprep/harness";
import type { GamePhase } from "@outprep/engine";
import type { PhaseValues } from "../state/types";
import { bootstrapCI } from "./significance";

export interface MoveAccuracyResult {
  /** Overall top-1 match rate [0, 1] */
  overall: number;
  /** Per-phase accuracy */
  byPhase: PhaseValues;
  /** Number of positions evaluated */
  positionsEvaluated: number;
  /** 95% bootstrap confidence interval */
  confidence95: [number, number];
  /** Per-phase confidence intervals */
  phaseCI95: Record<string, [number, number]>;
  /** Accuracy on engine-sourced positions only (excludes opening trie matches) */
  engineOnly: number;
  /** Accuracy on book-sourced positions only */
  bookMatchRate: number;
  /** Fraction of positions that came from the opening trie */
  bookFraction: number;
  /** Number of engine-sourced positions */
  enginePositions: number;
}

/**
 * Compute move prediction accuracy from position-level results.
 */
export function computeMoveAccuracy(
  positions: PositionResult[],
  opts: { seed?: number } = {}
): MoveAccuracyResult {
  const seed = opts.seed ?? 42;

  if (positions.length === 0) {
    const empty: PhaseValues = { opening: 0, middlegame: 0, endgame: 0, overall: 0 };
    return {
      overall: 0,
      byPhase: empty,
      positionsEvaluated: 0,
      confidence95: [0, 0],
      phaseCI95: { opening: [0, 0], middlegame: [0, 0], endgame: [0, 0] },
      engineOnly: 0,
      bookMatchRate: 0,
      bookFraction: 0,
      enginePositions: 0,
    };
  }

  // Overall accuracy
  const matches: number[] = positions.map((p) => (p.isMatch ? 1 : 0));
  const overall = matches.reduce((s, v) => s + v, 0) / matches.length;

  // Non-book accuracy (engine-sourced positions only)
  const enginePositions = positions.filter((p) => p.botSource !== "book");
  const bookPositions = positions.filter((p) => p.botSource === "book");
  const engineMatches: number[] = enginePositions.map((p) => (p.isMatch ? 1 : 0));
  const bookMatches: number[] = bookPositions.map((p) => (p.isMatch ? 1 : 0));

  const engineOnly = engineMatches.length > 0
    ? engineMatches.reduce((s, v) => s + v, 0) / engineMatches.length
    : 0;
  const bookMatchRate = bookMatches.length > 0
    ? bookMatches.reduce((s, v) => s + v, 0) / bookMatches.length
    : 0;
  const bookFraction = bookPositions.length / positions.length;

  // Bootstrap CI for overall accuracy
  const confidence95 = bootstrapCI(
    matches,
    (sample) => sample.reduce((s, v) => s + v, 0) / sample.length,
    { seed }
  );

  // Per-phase accuracy
  const phases: GamePhase[] = ["opening", "middlegame", "endgame"];
  const byPhase: PhaseValues = { opening: 0, middlegame: 0, endgame: 0, overall };
  const phaseCI95: Record<string, [number, number]> = {};

  for (const phase of phases) {
    const phasePositions = positions.filter((p) => p.phase === phase);
    if (phasePositions.length === 0) {
      byPhase[phase] = 0;
      phaseCI95[phase] = [0, 0];
      continue;
    }

    const phaseMatches: number[] = phasePositions.map((p) => (p.isMatch ? 1 : 0));
    byPhase[phase] =
      phaseMatches.reduce((s, v) => s + v, 0) / phaseMatches.length;

    phaseCI95[phase] = bootstrapCI(
      phaseMatches,
      (sample) => sample.reduce((s, v) => s + v, 0) / sample.length,
      { seed }
    );
  }

  return {
    overall,
    byPhase,
    positionsEvaluated: positions.length,
    confidence95,
    phaseCI95,
    engineOnly,
    bookMatchRate,
    bookFraction,
    enginePositions: enginePositions.length,
  };
}

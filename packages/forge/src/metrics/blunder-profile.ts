/**
 * Phase-specific blunder rate profiling.
 *
 * Compares the bot's error pattern (mistakes and blunders per phase)
 * against the actual player's pattern. The goal is for the bot to
 * make errors in the same phases and at the same rate as the human.
 *
 * Uses outprep's existing thresholds:
 *   Mistake: >= 150cp loss
 *   Blunder: >= 300cp loss
 */

import type { PositionResult } from "@outprep/harness";
import type { GamePhase } from "@outprep/engine";
import type { PhaseValues } from "../state/types";

/** Default error thresholds (from engine's DEFAULT_CONFIG) */
const MISTAKE_THRESHOLD = 150;
const BLUNDER_THRESHOLD = 300;

export interface BlunderProfileResult {
  /** Per-phase blunder rate for the bot */
  botBlunderRate: PhaseValues;
  /** Per-phase blunder rate for the player */
  playerBlunderRate: PhaseValues;
  /** |bot - player| blunder rate delta per phase (lower = better) */
  blunderRateDelta: PhaseValues;

  /** Per-phase mistake rate for the bot */
  botMistakeRate: PhaseValues;
  /** Per-phase mistake rate for the player */
  playerMistakeRate: PhaseValues;
  /** |bot - player| mistake rate delta per phase (lower = better) */
  mistakeRateDelta: PhaseValues;

  /** Total positions with CPL data per phase */
  positionsWithCPL: Record<string, { bot: number; player: number }>;
}

interface PhaseRates {
  blunderRate: PhaseValues;
  mistakeRate: PhaseValues;
  counts: Record<string, number>;
}

/**
 * Compute error rates from CPL values per phase.
 */
function computeRates(
  positions: PositionResult[],
  cplField: "botCPL" | "actualCPL"
): PhaseRates {
  const phases: GamePhase[] = ["opening", "middlegame", "endgame"];
  const blunderRate: PhaseValues = { opening: 0, middlegame: 0, endgame: 0, overall: 0 };
  const mistakeRate: PhaseValues = { opening: 0, middlegame: 0, endgame: 0, overall: 0 };
  const counts: Record<string, number> = {};

  let totalBlunders = 0;
  let totalMistakes = 0;
  let totalWithCPL = 0;

  for (const phase of phases) {
    const phasePositions = positions.filter(
      (p) => p.phase === phase && p[cplField] !== undefined
    );
    counts[phase] = phasePositions.length;

    if (phasePositions.length === 0) {
      blunderRate[phase] = 0;
      mistakeRate[phase] = 0;
      continue;
    }

    let blunders = 0;
    let mistakes = 0;
    for (const p of phasePositions) {
      const cpl = p[cplField]!;
      if (cpl >= BLUNDER_THRESHOLD) blunders++;
      else if (cpl >= MISTAKE_THRESHOLD) mistakes++;
    }

    blunderRate[phase] = blunders / phasePositions.length;
    mistakeRate[phase] = mistakes / phasePositions.length;

    totalBlunders += blunders;
    totalMistakes += mistakes;
    totalWithCPL += phasePositions.length;
  }

  blunderRate.overall = totalWithCPL > 0 ? totalBlunders / totalWithCPL : 0;
  mistakeRate.overall = totalWithCPL > 0 ? totalMistakes / totalWithCPL : 0;

  return { blunderRate, mistakeRate, counts };
}

/**
 * Compute the blunder profile comparison between bot and player.
 */
export function computeBlunderProfile(
  positions: PositionResult[]
): BlunderProfileResult {
  const botRates = computeRates(positions, "botCPL");
  const playerRates = computeRates(positions, "actualCPL");

  const phases: GamePhase[] = ["opening", "middlegame", "endgame"];
  const blunderRateDelta: PhaseValues = { opening: 0, middlegame: 0, endgame: 0, overall: 0 };
  const mistakeRateDelta: PhaseValues = { opening: 0, middlegame: 0, endgame: 0, overall: 0 };
  const positionsWithCPL: Record<string, { bot: number; player: number }> = {};

  for (const phase of phases) {
    blunderRateDelta[phase] = Math.abs(
      botRates.blunderRate[phase] - playerRates.blunderRate[phase]
    );
    mistakeRateDelta[phase] = Math.abs(
      botRates.mistakeRate[phase] - playerRates.mistakeRate[phase]
    );
    positionsWithCPL[phase] = {
      bot: botRates.counts[phase],
      player: playerRates.counts[phase],
    };
  }

  blunderRateDelta.overall = Math.abs(
    botRates.blunderRate.overall - playerRates.blunderRate.overall
  );
  mistakeRateDelta.overall = Math.abs(
    botRates.mistakeRate.overall - playerRates.mistakeRate.overall
  );

  return {
    botBlunderRate: botRates.blunderRate,
    playerBlunderRate: playerRates.blunderRate,
    blunderRateDelta,
    botMistakeRate: botRates.mistakeRate,
    playerMistakeRate: playerRates.mistakeRate,
    mistakeRateDelta,
    positionsWithCPL,
  };
}

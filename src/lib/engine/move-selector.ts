import { ErrorProfile } from "../types";
import { GamePhase } from "./phase-detector";

/**
 * A candidate move returned by Stockfish MultiPV.
 */
export interface CandidateMove {
  uci: string;
  score: number; // centipawns from side-to-move's perspective
  depth: number;
  pv: string;
}

/**
 * Convert an approximate FIDE Elo to Stockfish Skill Level (0-20).
 * Linear mapping: 1100 → 0, 2800 → 20.
 */
export function eloToSkillLevel(elo: number): number {
  const skill = ((elo - 1100) / (2800 - 1100)) * 20;
  return Math.max(0, Math.min(20, Math.round(skill)));
}

/**
 * Calculate dynamic skill level that shifts by game phase.
 *
 * If an opponent's middlegame error rate is 2x their average, dynamicSkill drops
 * by 3 levels in the middlegame. If their endgame is clean (0.5x average), skill
 * goes UP by 3 in endgames.
 *
 * Formula:
 *   ratio = phaseErrorRate / overallErrorRate
 *   adjustment = round(-3 * log2(ratio))
 *   dynamicSkill = clamp(baseSkill + adjustment, 0, 20)
 */
export function dynamicSkillLevel(
  baseSkill: number,
  errorProfile: ErrorProfile,
  phase: GamePhase
): number {
  const phaseErrors = errorProfile[phase];
  const overallErrors = errorProfile.overall;

  // Need meaningful data to adjust
  if (
    overallErrors.errorRate === 0 ||
    overallErrors.totalMoves < 50 ||
    phaseErrors.totalMoves < 10
  ) {
    return baseSkill;
  }

  const ratio = phaseErrors.errorRate / overallErrors.errorRate;

  // Avoid log(0) — if ratio is effectively 0, player is perfect in this phase
  if (ratio < 0.01) return Math.min(20, baseSkill + 6);

  const adjustment = Math.round(-3 * Math.log2(ratio));
  return Math.max(0, Math.min(20, baseSkill + adjustment));
}

/**
 * Boltzmann (softmax) selection from MultiPV candidates.
 *
 * temperature = max(0.1, (20 - dynamicSkill) * 15)
 *
 * At high skill (low temperature): nearly always picks the best move.
 * At low skill (high temperature): frequently picks 2nd, 3rd, 4th best moves.
 *
 * The TYPE of mistake emerges naturally from the position — if the 2nd-best move
 * is 30cp worse (positional drift), that's what gets selected in quiet positions.
 * If it's 200cp worse (tactical miss), that happens in sharp positions.
 */
export function boltzmannSelect(
  candidates: CandidateMove[],
  skill: number
): CandidateMove {
  if (candidates.length === 0) {
    throw new Error("No candidate moves to select from");
  }
  if (candidates.length === 1) return candidates[0];

  const temperature = Math.max(0.1, (20 - skill) * 15);
  const maxScore = Math.max(...candidates.map((c) => c.score));

  // Compute weights using softmax
  const weights = candidates.map((c) =>
    Math.exp((c.score - maxScore) / temperature)
  );
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  // Normalize and sample
  let rand = Math.random() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return candidates[i];
  }

  return candidates[0];
}

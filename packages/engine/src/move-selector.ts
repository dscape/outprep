import type { ErrorProfile, CandidateMove, GamePhase, BotConfig } from "./types";
import { DEFAULT_CONFIG } from "./config";

/**
 * Convert an approximate FIDE Elo to Stockfish Skill Level.
 * Linear mapping: eloMin → skillMin, eloMax → skillMax.
 */
export function eloToSkillLevel(
  elo: number,
  config: Pick<BotConfig, "elo" | "skill"> = DEFAULT_CONFIG
): number {
  const { elo: eloRange, skill: skillRange } = config;
  const skill =
    ((elo - eloRange.min) / (eloRange.max - eloRange.min)) *
    (skillRange.max - skillRange.min) +
    skillRange.min;
  return Math.max(
    skillRange.min,
    Math.min(skillRange.max, Math.round(skill))
  );
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
 *   adjustment = round(scale * log2(ratio))
 *   dynamicSkill = clamp(baseSkill + adjustment, skillMin, skillMax)
 */
export function dynamicSkillLevel(
  baseSkill: number,
  errorProfile: ErrorProfile,
  phase: GamePhase,
  config: Pick<BotConfig, "dynamicSkill" | "skill"> = DEFAULT_CONFIG
): number {
  const { dynamicSkill: ds, skill: skillRange } = config;
  const phaseErrors = errorProfile[phase];
  const overallErrors = errorProfile.overall;

  // Need meaningful data to adjust
  if (
    overallErrors.errorRate === 0 ||
    overallErrors.totalMoves < ds.minOverallMoves ||
    phaseErrors.totalMoves < ds.minPhaseMoves
  ) {
    return baseSkill;
  }

  const ratio = phaseErrors.errorRate / overallErrors.errorRate;

  // Avoid log(0) — if ratio is effectively 0, player is perfect in this phase
  if (ratio < 0.01)
    return Math.min(skillRange.max, baseSkill + ds.perfectPhaseBonus);

  const adjustment = Math.round(ds.scale * Math.log2(ratio));
  return Math.max(
    skillRange.min,
    Math.min(skillRange.max, baseSkill + adjustment)
  );
}

/**
 * Boltzmann (softmax) selection from MultiPV candidates.
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
  skill: number,
  config: Pick<BotConfig, "boltzmann" | "skill"> = DEFAULT_CONFIG
): CandidateMove {
  if (candidates.length === 0) {
    throw new Error("No candidate moves to select from");
  }
  if (candidates.length === 1) return candidates[0];

  const { boltzmann, skill: skillRange } = config;
  const temperature = Math.max(
    boltzmann.temperatureFloor,
    (skillRange.max - skill) * boltzmann.temperatureScale
  );
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

/**
 * Convenience: compute temperature for a given skill level.
 * Useful for harness introspection.
 */
export function temperatureFromSkill(
  skill: number,
  config: Pick<BotConfig, "boltzmann" | "skill"> = DEFAULT_CONFIG
): number {
  const { boltzmann, skill: skillRange } = config;
  return Math.max(
    boltzmann.temperatureFloor,
    (skillRange.max - skill) * boltzmann.temperatureScale
  );
}

import type { BotConfig } from "./types";

/**
 * Deep-merge a partial BotConfig into a base config.
 *
 * BotConfig has nested plain objects (elo, skill, phase, error, etc.).
 * A naive `{ ...base, ...partial }` shallow-merge would replace entire
 * sub-objects when only one field is overridden — e.g.
 *   { boltzmann: { temperatureScale: 25 } }
 * would wipe out boltzmann.multiPvCount and boltzmann.temperatureFloor.
 *
 * This function merges one level deep: for each key in `partial`, if both
 * the base and partial values are plain objects, spread-merge them.
 * Arrays (like depthBySkill) are replaced wholesale, not merged element-wise.
 */
export function mergeConfig(
  base: BotConfig,
  partial: Partial<BotConfig> | undefined
): BotConfig {
  if (!partial) return base;

  const result = { ...base };

  for (const key of Object.keys(partial) as (keyof BotConfig)[]) {
    const baseVal = base[key];
    const partialVal = partial[key];

    if (
      baseVal != null &&
      partialVal != null &&
      typeof baseVal === "object" &&
      typeof partialVal === "object" &&
      !Array.isArray(baseVal) &&
      !Array.isArray(partialVal)
    ) {
      // Deep-merge one level: e.g. { ...base.boltzmann, ...partial.boltzmann }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = { ...baseVal, ...partialVal };
    } else if (partialVal !== undefined) {
      // Primitive or array: replace wholesale
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = partialVal;
    }
  }

  return result;
}

/**
 * Default bot configuration.
 *
 * Every value here was extracted from the hardcoded constants in the
 * original Outprep codebase. The harness and the app both use this
 * but can override any field via Partial<BotConfig>.
 */
export const DEFAULT_CONFIG: BotConfig = {
  // --- Elo / Skill mapping ---
  // Linear: elo 1100 → skill 0, elo 2800 → skill 20
  elo: { min: 1100, max: 2800 },
  skill: { min: 0, max: 20 },

  // --- Phase detection (non-pawn, non-king piece count) ---
  // Starting position has 14 pieces (2Q + 4R + 4B + 4N).
  // opening: > 10, middlegame: 7-10, endgame: ≤ 6
  phase: {
    openingAbove: 10,
    endgameAtOrBelow: 6,
  },

  // --- Error classification (centipawn loss) ---
  error: {
    mistake: 100,
    blunder: 300,
  },

  // --- Dynamic skill adjustment ---
  // adjustment = round(scale * log2(phaseErrorRate / overallErrorRate))
  dynamicSkill: {
    scale: -3,
    perfectPhaseBonus: 6,
    minOverallMoves: 50,
    minPhaseMoves: 10,
  },

  // --- Boltzmann move selection ---
  // temperature = max(floor, (skillMax - dynamicSkill) * scale)
  boltzmann: {
    multiPvCount: 4,
    temperatureFloor: 0.1,
    temperatureScale: 15,
  },

  // --- Search depth by skill level ---
  // [maxSkill, depth] pairs, checked in order
  depthBySkill: [
    [3, 5],
    [6, 7],
    [9, 10],
    [12, 12],
    [15, 15],
    [17, 17],
    [19, 20],
    [20, 22],
  ],

  // --- Opening trie ---
  trie: {
    maxPly: 40, // 20 full moves = 40 plies
    minGames: 3,
  },

  // --- Think time ---
  thinkTime: {
    enabled: true,
    baseByPhase: { opening: 1500, middlegame: 3000, endgame: 2500 },
    bookMoveRange: [500, 2000],
    difficultyBonusMax: 2000,
    closeEvalThreshold: 20,
    jitter: 1000,
    minimum: 300,
  },
};

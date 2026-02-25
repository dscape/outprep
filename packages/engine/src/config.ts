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
  elo: {
    min: 1100,
    max: 2800
  },
  skill: {
    min: 0,
    max: 20
  },
  phase: {
    openingAbove: 10,
    endgameAtOrBelow: 6
  },
  error: {
    mistake: 150,
    blunder: 300
  },
  dynamicSkill: {
    scale: -3,
    perfectPhaseBonus: 4,
    minOverallMoves: 50,
    minPhaseMoves: 10
  },
  boltzmann: {
    multiPvCount: 4,
    temperatureFloor: 0.1,
    temperatureScale: 15,
    temperatureBySkill: [
      [3,  270],  // skill 0-3   (beginners — high randomness)
      [6,  210],  // skill 4-6
      [9,  150],  // skill 7-9
      [12, 120],  // skill 10-12
      [15,  75],  // skill 13-15
      [17,  45],  // skill 16-17
      [19,  15],  // skill 18-19
      [20,   3],  // skill 20    (masters — near-deterministic)
    ],
  },
  depthBySkill: [
    [
      3,
      7
    ],
    [
      6,
      7
    ],
    [
      9,
      10
    ],
    [
      12,
      12
    ],
    [
      15,
      15
    ],
    [
      17,
      17
    ],
    [
      19,
      20
    ],
    [
      20,
      24
    ]
  ],
  trie: {
    maxPly: 40,
    minGames: 3
  },
  moveStyle: {
    influence: 1.0,
    captureBonus: 50,
    checkBonus: 40,
    quietBonus: 30,
    skillDamping: 0.8,
  },
  complexityDepth: {
    enabled: true,
    captureThreshold: 6,   // 6+ legal captures → tactical
    quietThreshold: 1,     // 0-1 legal captures → quiet
    tacticalBonus: 2,      // +2 depth for tactical positions
    quietReduction: 1,     // -1 depth for quiet positions
    minDepth: 4,           // absolute floor
  },
  thinkTime: {
    enabled: true,
    baseByPhase: {
      opening: 1500,
      middlegame: 3000,
      endgame: 2500
    },
    bookMoveRange: [
      500,
      2000
    ],
    difficultyBonusMax: 2000,
    closeEvalThreshold: 20,
    jitter: 1000,
    minimum: 300
  }
};

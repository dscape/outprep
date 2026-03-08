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
    multiPvCount: 6,
    temperatureFloor: 0.1,
    temperatureScale: 15,
    temperatureBySkill: [
      [3, 130],   // skill 0-3  (~1100-1400): high randomness, frequent errors
      [6, 70],    // skill 4-6  (~1400-1600): moderate randomness
      [9, 38],    // skill 7-9  (~1600-1800): picks best ~40-50%
      [12, 20],   // skill 10-12 (~1800-2000): picks best ~55-65%
      [15, 10],   // skill 13-15 (~2000-2200): picks best ~75%
      [18, 4],    // skill 16-18 (~2200-2500): picks best ~85-90%
      [20, 1],    // skill 19-20 (~2500-2800): near-deterministic
    ]
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
  moveStyle: {
    influence: 0.3,
    captureBonus: 30,
    checkBonus: 25,
    quietBonus: 20,
    skillDamping: 0.5
  },
  complexityDepth: {
    enabled: true,
    captureThreshold: 6,
    quietThreshold: 1,
    tacticalBonus: 2,
    quietReduction: 1,
    minDepth: 4
  },
  trie: {
    maxPly: 40,
    minGames: 3,
    winBias: 0
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

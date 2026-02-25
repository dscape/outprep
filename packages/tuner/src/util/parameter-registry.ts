/**
 * Priority-ordered registry of tunable BotConfig parameters.
 *
 * Each entry defines how to perturb a parameter for sweep experiments.
 * Parameters are ordered by expected accuracy impact (highest first).
 */

import type { BotConfig } from "@outprep/engine";

export interface TunableParameter {
  /** Dot-path into BotConfig, e.g. "boltzmann.temperatureScale" */
  path: string;
  /** Human-readable name */
  name: string;
  /** 1 = highest impact */
  priority: number;
  /** Generate candidate values from the current value */
  perturbations: (currentValue: unknown) => { value: unknown; label: string }[];
  /** Short description */
  description: string;
}

/**
 * Read a nested value from BotConfig by dot-path.
 */
export function getConfigValue(config: BotConfig, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = config;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Build a Partial<BotConfig> override from a dot-path and value.
 *
 * e.g. ("boltzmann.temperatureScale", 20) → { boltzmann: { temperatureScale: 20 } }
 */
export function buildOverride(path: string, value: unknown): Partial<BotConfig> {
  const parts = path.split(".");
  if (parts.length === 1) {
    return { [parts[0]]: value } as Partial<BotConfig>;
  }
  if (parts.length === 2) {
    return { [parts[0]]: { [parts[1]]: value } } as Partial<BotConfig>;
  }
  // Deeper nesting not needed for current BotConfig shape
  throw new Error(`Unsupported config path depth: ${path}`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const PARAMETER_REGISTRY: TunableParameter[] = [
  // ── Priority 1: Boltzmann temperature scale ─────────────────
  {
    path: "boltzmann.temperatureScale",
    name: "Temperature Scale",
    priority: 1,
    description: "Controls move randomness per skill level (higher = more random)",
    perturbations: (v) => {
      const n = v as number;
      return [
        { value: round2(n * 0.7), label: `tempScale ×0.7 (${round2(n * 0.7)})` },
        { value: round2(n * 0.85), label: `tempScale ×0.85 (${round2(n * 0.85)})` },
        { value: round2(n * 1.15), label: `tempScale ×1.15 (${round2(n * 1.15)})` },
        { value: round2(n * 1.3), label: `tempScale ×1.3 (${round2(n * 1.3)})` },
      ];
    },
  },

  // ── Priority 2: Depth by skill ──────────────────────────────
  {
    path: "depthBySkill",
    name: "Depth by Skill",
    priority: 2,
    description: "Maps skill level to search depth",
    perturbations: (v) => {
      const arr = v as [number, number][];
      const results: { value: unknown; label: string }[] = [];
      // Try bumping depth at low, mid, and high skill
      const indices = [0, Math.floor(arr.length / 2), arr.length - 1];
      for (const i of indices) {
        const upArr = arr.map((pair) => [...pair] as [number, number]);
        upArr[i] = [upArr[i][0], upArr[i][1] + 2];
        results.push({
          value: upArr,
          label: `depth[${i}] +2 (skill≤${arr[i][0]}: ${arr[i][1]}→${arr[i][1] + 2})`,
        });

        if (arr[i][1] > 3) {
          const downArr = arr.map((pair) => [...pair] as [number, number]);
          downArr[i] = [downArr[i][0], Math.max(1, downArr[i][1] - 2)];
          results.push({
            value: downArr,
            label: `depth[${i}] -2 (skill≤${arr[i][0]}: ${arr[i][1]}→${Math.max(1, arr[i][1] - 2)})`,
          });
        }
      }
      return results;
    },
  },

  // ── Priority 3: Dynamic skill scale ─────────────────────────
  {
    path: "dynamicSkill.scale",
    name: "Dynamic Skill Scale",
    priority: 3,
    description: "Log2 coefficient for phase-based skill adjustment",
    perturbations: (v) => {
      const n = v as number;
      return [
        { value: round2(n - 1), label: `dynScale ${n}→${round2(n - 1)}` },
        { value: round2(n - 0.5), label: `dynScale ${n}→${round2(n - 0.5)}` },
        { value: round2(n + 0.5), label: `dynScale ${n}→${round2(n + 0.5)}` },
        { value: round2(n + 1), label: `dynScale ${n}→${round2(n + 1)}` },
      ];
    },
  },

  // ── Priority 4: Perfect phase bonus ─────────────────────────
  {
    path: "dynamicSkill.perfectPhaseBonus",
    name: "Perfect Phase Bonus",
    priority: 4,
    description: "Skill boost when phase error rate is near zero",
    perturbations: (v) => {
      const n = v as number;
      return [
        { value: Math.max(0, n - 2), label: `perfBonus ${n}→${Math.max(0, n - 2)}` },
        { value: n + 2, label: `perfBonus ${n}→${n + 2}` },
        { value: n + 4, label: `perfBonus ${n}→${n + 4}` },
      ];
    },
  },

  // ── Priority 5: Error thresholds ────────────────────────────
  {
    path: "error.mistake",
    name: "Mistake Threshold",
    priority: 5,
    description: "Minimum centipawn loss for mistake classification",
    perturbations: (v) => {
      const n = v as number;
      return [
        { value: Math.max(25, n - 25), label: `mistake ${n}→${Math.max(25, n - 25)}` },
        { value: n + 25, label: `mistake ${n}→${n + 25}` },
        { value: n + 50, label: `mistake ${n}→${n + 50}` },
      ];
    },
  },
  {
    path: "error.blunder",
    name: "Blunder Threshold",
    priority: 5,
    description: "Minimum centipawn loss for blunder classification",
    perturbations: (v) => {
      const n = v as number;
      return [
        { value: Math.max(100, n - 50), label: `blunder ${n}→${Math.max(100, n - 50)}` },
        { value: n + 50, label: `blunder ${n}→${n + 50}` },
      ];
    },
  },

  // ── Priority 6: Min moves thresholds ────────────────────────
  {
    path: "dynamicSkill.minOverallMoves",
    name: "Min Overall Moves",
    priority: 6,
    description: "Minimum total moves for dynamic adjustment to apply",
    perturbations: (v) => {
      const n = v as number;
      return [
        { value: Math.round(n * 0.6), label: `minMoves ${n}→${Math.round(n * 0.6)}` },
        { value: Math.round(n * 1.5), label: `minMoves ${n}→${Math.round(n * 1.5)}` },
      ];
    },
  },

  // ── Priority 7: Trie min games ──────────────────────────────
  {
    path: "trie.minGames",
    name: "Trie Min Games",
    priority: 7,
    description: "Minimum games for opening trie position inclusion",
    perturbations: (v) => {
      const n = v as number;
      return [
        { value: Math.max(1, n - 1), label: `trieMin ${n}→${Math.max(1, n - 1)}` },
        { value: n + 1, label: `trieMin ${n}→${n + 1}` },
        { value: n + 2, label: `trieMin ${n}→${n + 2}` },
      ];
    },
  },

  // ── Priority 8: Temperature floor ──────────────────────────
  {
    path: "boltzmann.temperatureFloor",
    name: "Temperature Floor",
    priority: 8,
    description: "Minimum temperature (prevents deterministic play at high skill)",
    perturbations: (v) => {
      const n = v as number;
      return [
        { value: round2(n * 0.5), label: `tempFloor ×0.5 (${round2(n * 0.5)})` },
        { value: round2(n * 2), label: `tempFloor ×2 (${round2(n * 2)})` },
        { value: round2(n * 3), label: `tempFloor ×3 (${round2(n * 3)})` },
      ];
    },
  },

  // ── Priority 9: MultiPV count ──────────────────────────────
  {
    path: "boltzmann.multiPvCount",
    name: "MultiPV Count",
    priority: 9,
    description: "Number of candidate moves for Boltzmann sampling",
    perturbations: (v) => {
      const n = v as number;
      const results: { value: unknown; label: string }[] = [];
      if (n > 2) results.push({ value: n - 1, label: `multiPV ${n}→${n - 1}` });
      results.push({ value: n + 1, label: `multiPV ${n}→${n + 1}` });
      results.push({ value: n + 2, label: `multiPV ${n}→${n + 2}` });
      return results;
    },
  },

  // ── Priority 10: Phase boundaries ──────────────────────────
  {
    path: "phase.openingAbove",
    name: "Opening Phase Threshold",
    priority: 10,
    description: "Piece count above which position is considered opening",
    perturbations: (v) => {
      const n = v as number;
      return [
        { value: Math.max(6, n - 1), label: `openAbove ${n}→${Math.max(6, n - 1)}` },
        { value: n + 1, label: `openAbove ${n}→${n + 1}` },
      ];
    },
  },
  {
    path: "phase.endgameAtOrBelow",
    name: "Endgame Phase Threshold",
    priority: 10,
    description: "Piece count at or below which position is considered endgame",
    perturbations: (v) => {
      const n = v as number;
      return [
        { value: Math.max(2, n - 1), label: `endBelow ${n}→${Math.max(2, n - 1)}` },
        { value: n + 1, label: `endBelow ${n}→${n + 1}` },
      ];
    },
  },
];

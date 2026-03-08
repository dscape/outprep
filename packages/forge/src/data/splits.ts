/**
 * Deterministic train/test split for game datasets.
 *
 * Splits operate at the GAME level — entire games go to either the
 * train or test set, never both. Uses the same LCG PRNG as the
 * harness for reproducibility: `rng = (rng * 1664525 + 1013904223) >>> 0`.
 *
 * Phase-balanced mode ensures the test set has representative coverage
 * across opening, middlegame, and endgame positions by classifying
 * games by their length and balancing accordingly.
 */

import { createHash } from "node:crypto";
import type { LichessGame } from "@outprep/harness";
import type { DataSplit } from "../state/types.js";

/* ── Types ────────────────────────────────────────────────── */

export interface SplitOptions {
  /** PRNG seed for deterministic shuffle. Default: 42 */
  seed?: number;
  /** Fraction of games for training. Default: 0.8 */
  trainRatio?: number;
  /** Balance test set across game phases by length. Default: false */
  phaseBalanced?: boolean;
  /** Username (used in DataSplit metadata). Default: "unknown" */
  username?: string;
}

export interface SplitResult {
  trainGames: LichessGame[];
  testGames: LichessGame[];
  split: DataSplit;
}

/* ── Seeded PRNG (same LCG as harness) ────────────────────── */

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let rng = seed;
  for (let i = result.length - 1; i > 0; i--) {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    const j = rng % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/* ── Position counting ────────────────────────────────────── */

/**
 * Count the number of player-side positions (moves) in a game.
 * Each move in the `moves` string is one ply; total plies / 2
 * gives a rough count per side.
 */
function countPositions(games: LichessGame[]): number {
  let total = 0;
  for (const game of games) {
    if (!game.moves) continue;
    const plyCount = game.moves.split(" ").filter(Boolean).length;
    // Each side gets roughly half the positions
    total += Math.ceil(plyCount / 2);
  }
  return total;
}

/* ── Phase classification by game length ──────────────────── */

type PhaseCategory = "short" | "medium" | "long";

/**
 * Classify a game by its length as a proxy for phase coverage:
 * - short  (< 40 plies):  mostly opening positions
 * - medium (40-80 plies):  good middlegame coverage
 * - long   (> 80 plies):  includes endgame positions
 */
function classifyByLength(game: LichessGame): PhaseCategory {
  const plyCount = game.moves ? game.moves.split(" ").filter(Boolean).length : 0;
  if (plyCount < 40) return "short";
  if (plyCount <= 80) return "medium";
  return "long";
}

/* ── Content hash ─────────────────────────────────────────── */

function computeSplitHash(
  trainIds: string[],
  testIds: string[],
  seed: number,
  trainRatio: number
): string {
  const payload = JSON.stringify({
    seed,
    trainRatio,
    train: [...trainIds].sort(),
    test: [...testIds].sort(),
  });
  return createHash("sha256").update(payload).digest("hex");
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Split games into deterministic train/test sets.
 *
 * Same seed + same games array = identical split every time.
 * Phase-balanced mode ensures the test set has proportional
 * representation of short/medium/long games (proxy for
 * opening/middlegame/endgame coverage).
 */
export function createSplit(
  games: LichessGame[],
  opts: SplitOptions = {}
): SplitResult {
  const seed = opts.seed ?? 42;
  const trainRatio = opts.trainRatio ?? 0.8;
  const phaseBalanced = opts.phaseBalanced ?? false;
  const username = opts.username ?? "unknown";

  if (games.length === 0) {
    return {
      trainGames: [],
      testGames: [],
      split: {
        username,
        seed,
        trainRatio,
        trainGameCount: 0,
        testGameCount: 0,
        trainPositionCount: 0,
        testPositionCount: 0,
        splitHash: computeSplitHash([], [], seed, trainRatio),
      },
    };
  }

  let trainGames: LichessGame[];
  let testGames: LichessGame[];

  if (!phaseBalanced) {
    // Simple split: shuffle all games, take first N for train
    const shuffled = seededShuffle(games, seed);
    const trainCount = Math.round(games.length * trainRatio);

    trainGames = shuffled.slice(0, trainCount);
    testGames = shuffled.slice(trainCount);
  } else {
    // Phase-balanced split: ensure test set has representative
    // coverage across game lengths (proxy for phases).
    const buckets: Record<PhaseCategory, LichessGame[]> = {
      short: [],
      medium: [],
      long: [],
    };

    for (const game of games) {
      buckets[classifyByLength(game)].push(game);
    }

    trainGames = [];
    testGames = [];

    // Split each bucket independently with the same ratio,
    // using a derived seed per bucket for independence
    const categories: PhaseCategory[] = ["short", "medium", "long"];
    for (let ci = 0; ci < categories.length; ci++) {
      const category = categories[ci];
      const bucket = buckets[category];
      if (bucket.length === 0) continue;

      // Derive a per-bucket seed so the shuffle is independent
      const bucketSeed = (seed + ci * 7919) >>> 0;
      const shuffled = seededShuffle(bucket, bucketSeed);
      const trainCount = Math.round(bucket.length * trainRatio);

      trainGames.push(...shuffled.slice(0, trainCount));
      testGames.push(...shuffled.slice(trainCount));
    }
  }

  const trainIds = trainGames.map((g) => g.id);
  const testIds = testGames.map((g) => g.id);

  const split: DataSplit = {
    username,
    seed,
    trainRatio,
    trainGameCount: trainGames.length,
    testGameCount: testGames.length,
    trainPositionCount: countPositions(trainGames),
    testPositionCount: countPositions(testGames),
    splitHash: computeSplitHash(trainIds, testIds, seed, trainRatio),
  };

  return { trainGames, testGames, split };
}

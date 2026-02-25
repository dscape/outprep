/**
 * Move style analysis and bias — nudges bot move selection toward a player's
 * natural playing style (aggressive, tactical, positional, etc.).
 *
 * Three main exports:
 *   classifyMove()           — categorize a candidate as capture/check/quiet
 *   applyStyleBonus()        — adjust candidate scores before Boltzmann
 *   analyzeStyleFromRecords() — compute StyleMetrics from GameRecord[]
 */

import { Chess } from "chess.js";
import type { CandidateMove, GameRecord, StyleMetrics, BotConfig } from "./types";

/* ── Move Classification ─────────────────────────────────── */

export type MoveType = "capture" | "check" | "quiet";

/**
 * Classify a UCI move as capture, check, or quiet.
 * Uses chess.js to play the move and inspect the result.
 */
export function classifyMove(fen: string, uci: string): MoveType {
  try {
    const chess = new Chess(fen);
    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);
    const promotion = uci.length > 4 ? uci.substring(4) : undefined;

    const move = chess.move({ from, to, promotion });
    if (!move) return "quiet";

    if (move.captured) return "capture";
    if (chess.inCheck()) return "check";
    return "quiet";
  } catch {
    return "quiet";
  }
}

/* ── Style Bonus ─────────────────────────────────────────── */

/**
 * Apply style-based centipawn bonuses to candidate moves.
 *
 * For each candidate, classify the move and add a bonus based on
 * the player's style scores. Returns a NEW array (no mutation).
 *
 * Skill-dependent damping:
 *   effectiveInfluence = influence × (1 − (skill / skillMax) × skillDamping)
 *
 * Formula per candidate:
 *   aggrBias = (style.aggression - 50) / 50    // −1 to +1
 *   tactBias = (style.tactical - 50) / 50
 *   posBias  = (style.positional - 50) / 50
 *
 *   bonus = 0
 *   if capture:  bonus += aggrBias × captureBonus
 *   if check:    bonus += tactBias × checkBonus
 *   if quiet:    bonus += posBias  × quietBonus
 *
 *   adjustedScore = score + bonus × effectiveInfluence
 */
export function applyStyleBonus(
  candidates: CandidateMove[],
  fen: string,
  style: StyleMetrics,
  config: Pick<BotConfig, "moveStyle" | "skill">,
  dynamicSkill: number
): CandidateMove[] {
  const ms = config.moveStyle;
  if (!ms || ms.influence === 0 || candidates.length === 0) return candidates;

  // Skill-dependent damping: influence fades as skill increases
  const skillNorm = dynamicSkill / config.skill.max;
  const effectiveInfluence = ms.influence * (1 - skillNorm * ms.skillDamping);
  if (effectiveInfluence <= 0) return candidates;

  const aggrBias = (style.aggression - 50) / 50;
  const tactBias = (style.tactical - 50) / 50;
  const posBias = (style.positional - 50) / 50;

  return candidates.map((c) => {
    const moveType = classifyMove(fen, c.uci);
    let bonus = 0;

    switch (moveType) {
      case "capture":
        bonus = aggrBias * ms.captureBonus;
        break;
      case "check":
        bonus = tactBias * ms.checkBonus;
        break;
      case "quiet":
        bonus = posBias * ms.quietBonus;
        break;
    }

    return { ...c, score: c.score + bonus * effectiveInfluence };
  });
}

/* ── Style Analysis from GameRecords ─────────────────────── */

/**
 * Compute StyleMetrics from an array of GameRecord objects.
 *
 * Mirrors the app's analyzeStyle() logic but works with the engine's
 * platform-agnostic GameRecord type (no LichessGame dependency).
 *
 * Metrics:
 *   aggression — quick wins (<30 moves) + material sacrifice frequency
 *   tactical   — short decisive games (<40 moves)
 *   positional — inverse early-loss rate + game-length bonus
 *   endgame    — long-game (>30 moves) conversion rate
 *
 * All scores 0-100, Bayesian-dampened toward 50 for small samples.
 */
export function analyzeStyleFromRecords(records: GameRecord[]): StyleMetrics {
  if (records.length === 0) {
    return { aggression: 50, tactical: 50, positional: 50, endgame: 50, sampleSize: 0 };
  }

  let earlyAttacks = 0;
  let sacrifices = 0;
  let tacticalWins = 0;
  let longGames = 0;
  let longGameWins = 0;
  let totalMoves = 0;
  let earlyLosses = 0;
  let gamesAnalyzed = 0;

  for (const record of records) {
    if (!record.moves) continue;

    const moves = record.moves.split(" ");
    const moveCount = Math.floor(moves.length / 2);
    totalMoves += moveCount;
    gamesAnalyzed++;

    const isWhite = record.playerColor === "white";
    const won =
      (isWhite && record.result === "white") ||
      (!isWhite && record.result === "black");
    const lost =
      (isWhite && record.result === "black") ||
      (!isWhite && record.result === "white");

    // Aggression: short decisive wins
    if (moveCount < 30 && won) earlyAttacks++;

    // Sacrifice detection via chess.js material tracking
    try {
      const chess = new Chess();
      let prevMyMaterial = isWhite ? 39 : 39; // starting material (excluding king)
      const movesToCheck = Math.min(moves.length, 40);
      for (let i = 0; i < movesToCheck; i++) {
        try {
          chess.move(moves[i]);
          const material = countMaterial(chess);
          const myMaterial = isWhite ? material.white : material.black;
          if (prevMyMaterial - myMaterial >= 3 && i > 5) {
            sacrifices++;
          }
          prevMyMaterial = myMaterial;
        } catch {
          break;
        }
      }
    } catch {
      // skip malformed games
    }

    // Tactical: short decisive games
    if (moveCount < 40 && record.result !== "draw" && record.result != null) {
      tacticalWins++;
    }

    // Endgame: long games and conversion rate
    if (moveCount > 30) {
      longGames++;
      if (won) longGameWins++;
    }

    // Early losses for positional score
    if (moveCount < 25 && lost) earlyLosses++;
  }

  if (gamesAnalyzed === 0) {
    return { aggression: 50, tactical: 50, positional: 50, endgame: 50, sampleSize: 0 };
  }

  const avgMoves = totalMoves / gamesAnalyzed;

  // Aggression: % of games won quickly + sacrifice frequency
  const earlyWinPct = (earlyAttacks / gamesAnalyzed) * 100;
  const sacrificePct = (sacrifices / gamesAnalyzed) * 100;
  const aggression = Math.min(100, Math.round(earlyWinPct * 0.7 + sacrificePct * 0.3));

  // Tactical: % of decisive games that ended in under 40 moves
  const tactical = Math.min(100, Math.round((tacticalWins / gamesAnalyzed) * 100));

  // Positional: inverse of early-loss rate, bonus for longer average game length
  const earlyLossPct = (earlyLosses / gamesAnalyzed) * 100;
  const lengthBonus = Math.min(20, Math.max(0, (avgMoves - 25) * 0.8));
  const positional = clamp(Math.round(70 - earlyLossPct * 1.5 + lengthBonus), 0, 100);

  // Endgame: conversion rate in long games
  const endgame =
    longGames > 0
      ? Math.min(100, Math.round((longGameWins / longGames) * 100))
      : 50;

  // Bayesian dampening: pull toward 50 when sample is small
  return {
    aggression: clamp(Math.round(dampen(aggression, gamesAnalyzed)), 0, 100),
    tactical: clamp(Math.round(dampen(tactical, gamesAnalyzed)), 0, 100),
    positional: clamp(Math.round(dampen(positional, gamesAnalyzed)), 0, 100),
    endgame: clamp(Math.round(dampen(endgame, gamesAnalyzed)), 0, 100),
    sampleSize: gamesAnalyzed,
  };
}

/* ── Helpers ──────────────────────────────────────────────── */

function countMaterial(chess: Chess): { white: number; black: number } {
  const board = chess.board();
  let white = 0;
  let black = 0;
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  for (const row of board) {
    for (const square of row) {
      if (square) {
        const val = values[square.type] || 0;
        if (square.color === "w") white += val;
        else black += val;
      }
    }
  }

  return { white, black };
}

/** Bayesian dampening: pull raw score toward 50 (neutral) when sample is small */
function dampen(raw: number, n: number, k = 30): number {
  return raw * (n / (n + k)) + 50 * (k / (n + k));
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

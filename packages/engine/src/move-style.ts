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
  let totalMoves = 0;
  let earlyLosses = 0;
  let gamesAnalyzed = 0;
  let totalWins = 0;
  let totalDraws = 0;

  // Endgame: long game (>=40 moves) vs short game decisive win rate
  let longGameWins = 0;
  let longGameLosses = 0;
  let longGameTotal = 0;
  let shortGameWins = 0;
  let shortGameLosses = 0;
  let shortGameTotal = 0;

  // Positional: long game draws
  let longGameDraws = 0;

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
    const drew = record.result === "draw";

    if (won) totalWins++;
    if (drew) totalDraws++;

    // Aggression: short wins (for quickWinRatio) + sacrifices
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

    // Endgame: track decisive results in long (>=40 moves) vs short games
    if (moveCount >= 40) {
      longGameTotal++;
      if (won) longGameWins++;
      else if (lost) longGameLosses++;
      else if (drew) longGameDraws++;
    } else {
      shortGameTotal++;
      if (won) shortGameWins++;
      else if (lost) shortGameLosses++;
    }

    // Early losses for positional score
    if (moveCount < 25 && lost) earlyLosses++;
  }

  if (gamesAnalyzed === 0) {
    return { aggression: 50, tactical: 50, positional: 50, endgame: 50, sampleSize: 0 };
  }

  const avgMoves = totalMoves / gamesAnalyzed;

  // Aggression: of all wins, what % came quickly + sacrifice frequency
  const quickWinRatio = totalWins > 0 ? (earlyAttacks / totalWins) * 100 : 0;
  const sacrificePct = (sacrifices / gamesAnalyzed) * 100;
  const aggression = Math.min(100, Math.round(quickWinRatio * 0.7 + sacrificePct * 0.3));

  // Tactical: decisive game rate + sacrifice frequency
  // Tactical players create sharp positions — games end decisively (few draws)
  // When draws are rare (online blitz), discount the decisive rate — it reflects
  // the format more than style. drawCredit scales linearly: full credit at ≥20% draws.
  const decisiveRate = (gamesAnalyzed - totalDraws) / gamesAnalyzed;
  const drawRate = totalDraws / gamesAnalyzed;
  const drawCredit = Math.min(1, drawRate / 0.20);
  const effectiveDecisive = 0.5 + (decisiveRate - 0.5) * drawCredit;
  const sacrificeBonus = Math.min(15, (sacrifices / gamesAnalyzed) * 5);
  const tactical = clamp(Math.round(effectiveDecisive * 92 + sacrificeBonus), 0, 100);

  // Positional: inverse early-loss rate + game length bonus + long-game draw survival
  // Positional players hold solid positions, play longer games, and grind
  const earlyLossPct = (earlyLosses / gamesAnalyzed) * 100;
  const lengthBonus = Math.min(35, Math.max(0, (avgMoves - 25) * 1.0));
  const longDrawRate = longGameTotal > 0 ? longGameDraws / longGameTotal : 0;
  const positional = clamp(Math.round(50 - earlyLossPct * 2 + lengthBonus + longDrawRate * 20), 0, 100);

  // Endgame: combines frequency of long games × non-loss rate in them
  let endgame = 50;
  if (longGameTotal >= 5) {
    const endgameFreq = longGameTotal / gamesAnalyzed;
    const holdRate = 1 - (longGameLosses / longGameTotal);
    endgame = clamp(Math.round(endgameFreq * holdRate * 150), 0, 100);
  }

  // Bayesian dampening: pull toward 50 when sample is small
  // Then boost scores above 50 so human-level play fills the 50-100 range
  return {
    aggression: boost(clamp(Math.round(dampen(aggression, gamesAnalyzed)), 0, 100)),
    tactical: boost(clamp(Math.round(dampen(tactical, gamesAnalyzed)), 0, 100)),
    positional: boost(clamp(Math.round(dampen(positional, gamesAnalyzed)), 0, 100)),
    endgame: boost(clamp(Math.round(dampen(endgame, longGameTotal)), 0, 100)),
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

/** Stretch scores above 50 to fill the human range; leave below-50 as-is. */
function boost(raw: number, factor = 1.5): number {
  return raw <= 50 ? raw : clamp(Math.round(50 + (raw - 50) * factor), 50, 100);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

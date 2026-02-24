import { Chess } from "chess.js";
import type { GamePhase, BotConfig } from "./types";
import { DEFAULT_CONFIG } from "./config";

/**
 * Count non-pawn, non-king pieces on the board (both sides combined).
 * Starting game has 14 (2Q + 4R + 4B + 4N).
 */
export function countMinorMajorPieces(fen: string): number {
  const chess = new Chess(fen);
  const board = chess.board();
  let count = 0;

  for (const row of board) {
    for (const square of row) {
      if (square && square.type !== "p" && square.type !== "k") {
        count++;
      }
    }
  }

  return count;
}

/**
 * Detect game phase from a FEN position using material counting.
 */
export function detectPhase(
  fen: string,
  config: Pick<BotConfig, "phase"> = DEFAULT_CONFIG
): GamePhase {
  const pieces = countMinorMajorPieces(fen);

  if (pieces > config.phase.openingAbove) return "opening";
  if (pieces <= config.phase.endgameAtOrBelow) return "endgame";
  return "middlegame";
}

/**
 * Continuous material score: 0.0 = empty board, 1.0 = all 14 pieces present.
 * Useful for smooth interpolation between phases.
 */
export function materialScore(fen: string): number {
  const pieces = countMinorMajorPieces(fen);
  return Math.min(1, pieces / 14);
}

/**
 * Detect phase from a chess.js Chess instance (avoids re-parsing FEN).
 */
export function detectPhaseFromBoard(
  chess: Chess,
  config: Pick<BotConfig, "phase"> = DEFAULT_CONFIG
): GamePhase {
  const board = chess.board();
  let count = 0;

  for (const row of board) {
    for (const square of row) {
      if (square && square.type !== "p" && square.type !== "k") {
        count++;
      }
    }
  }

  if (count > config.phase.openingAbove) return "opening";
  if (count <= config.phase.endgameAtOrBelow) return "endgame";
  return "middlegame";
}

import { Chess } from "chess.js";

export type GamePhase = "opening" | "middlegame" | "endgame";

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
 * - Opening: >10 minor/major pieces remaining
 * - Middlegame: 7-10 pieces remaining
 * - Endgame: ≤6 pieces remaining (matches Lichess's threshold)
 */
export function detectPhase(fen: string): GamePhase {
  const pieces = countMinorMajorPieces(fen);

  if (pieces > 10) return "opening";
  if (pieces >= 7) return "middlegame";
  return "endgame";
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
export function detectPhaseFromBoard(chess: Chess): GamePhase {
  const board = chess.board();
  let count = 0;

  for (const row of board) {
    for (const square of row) {
      if (square && square.type !== "p" && square.type !== "k") {
        count++;
      }
    }
  }

  if (count > 10) return "opening";
  if (count >= 7) return "middlegame";
  return "endgame";
}

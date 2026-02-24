/**
 * Generate English descriptions of why a blunder/mistake was bad.
 * Uses chess.js to simulate moves and detect tactical consequences.
 */

import { Chess } from "chess.js";
import { MoveEval } from "../types";

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

function pieceName(type: string): string {
  return PIECE_NAMES[type.toLowerCase()] || "piece";
}

function materialCount(chess: Chess): { white: number; black: number } {
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let white = 0;
  let black = 0;

  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq && sq.type !== "k") {
        const val = values[sq.type] || 0;
        if (sq.color === "w") white += val;
        else black += val;
      }
    }
  }

  return { white, black };
}

function tryUciMove(chess: Chess, uci: string): ReturnType<Chess["move"]> | null {
  if (!uci || uci.length < 4) return null;
  try {
    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);
    const promo = uci.length > 4 ? uci[4] : undefined;
    return chess.move({
      from,
      to,
      promotion: promo as "q" | "r" | "b" | "n" | undefined,
    });
  } catch {
    return null;
  }
}

/**
 * Generate a short English description of a move error.
 */
export function describeMoveError(move: MoveEval): string {
  if (move.classification === "normal" || move.classification === "good" || move.classification === "great") {
    return "";
  }

  try {
    // 1. Check if the best move delivers checkmate
    if (move.bestMove) {
      const chessBest = new Chess(move.fen);
      const bestResult = tryUciMove(chessBest, move.bestMove);
      if (bestResult && chessBest.isCheckmate()) {
        return "Missed checkmate in one";
      }
      // Check if best move wins material via capture
      if (bestResult?.captured) {
        const capturedName = pieceName(bestResult.captured);
        if (bestResult.captured === "q") {
          return `Missed winning the opponent's queen`;
        }
        if (bestResult.captured === "r") {
          return `Missed winning a rook`;
        }
        if (bestResult.captured === "n" || bestResult.captured === "b") {
          return `Missed winning a ${capturedName}`;
        }
      }
    }

    // 2. Check if the played move allows checkmate
    if (move.exploitMove) {
      const chessAfter = new Chess(move.fen);
      const playedResult = chessAfter.move(move.san);
      if (playedResult) {
        const exploitResult = tryUciMove(chessAfter, move.exploitMove);
        if (exploitResult && chessAfter.isCheckmate()) {
          return "Allowed checkmate";
        }

        // 3. Check if the exploitation wins material
        if (exploitResult?.captured) {
          const capturedName = pieceName(exploitResult.captured);
          if (exploitResult.captured === "q") {
            return "Hung the queen";
          }
          if (exploitResult.captured === "r") {
            return `Lost a rook`;
          }
          if (exploitResult.captured === "n" || exploitResult.captured === "b") {
            return `Lost a ${capturedName}`;
          }
          return `Lost a ${capturedName}`;
        }

        // 4. Check if exploitation delivers check
        if (exploitResult && chessAfter.isCheck()) {
          return "Allowed a check winning material";
        }
      }
    }

    // 5. Material comparison approach — play the move and check what changed
    if (move.exploitMove) {
      const chessBefore = new Chess(move.fen);
      const matBefore = materialCount(chessBefore);

      const chessPlay = new Chess(move.fen);
      const played = chessPlay.move(move.san);
      if (played) {
        const exploit = tryUciMove(chessPlay, move.exploitMove);
        if (exploit) {
          const matAfter = materialCount(chessPlay);
          const isWhiteTurn = move.fen.split(" ")[1] === "w";

          const playerMatBefore = isWhiteTurn ? matBefore.white : matBefore.black;
          const playerMatAfter = isWhiteTurn ? matAfter.white : matAfter.black;
          const opponentMatBefore = isWhiteTurn ? matBefore.black : matBefore.white;
          const opponentMatAfter = isWhiteTurn ? matAfter.black : matAfter.white;

          const playerLoss = playerMatBefore - playerMatAfter;
          const opponentLoss = opponentMatBefore - opponentMatAfter;
          const netLoss = playerLoss - opponentLoss;

          if (netLoss >= 8) return "Lost major material";
          if (netLoss >= 4) return "Lost significant material";
          if (netLoss >= 2) return "Lost material";
        }
      }
    }

    // 6. Generic descriptions by severity
    if (move.classification === "blunder") {
      if (Math.abs(move.evalDelta) >= 500) return "Game-changing blunder";
      return "Serious mistake that shifted the evaluation";
    }

    if (move.classification === "mistake") {
      return "Missed a better continuation";
    }

    if (move.classification === "inaccuracy") {
      return "Slightly imprecise — a better option was available";
    }

    return "";
  } catch {
    // Fallback if anything goes wrong
    if (move.classification === "blunder") return "Critical blunder";
    if (move.classification === "mistake") return "Missed a better continuation";
    if (move.classification === "inaccuracy") return "Slightly imprecise";
    return "";
  }
}

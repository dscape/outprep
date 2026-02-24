import { Chess } from "chess.js";
import { StockfishEngine } from "../stockfish-worker";
import { MoveEval, AnalysisSummary } from "../types";

const INACCURACY_THRESHOLD = 50;
const MISTAKE_THRESHOLD = 100;
const BLUNDER_THRESHOLD = 200;
const ANALYSIS_DEPTH = 18;

export async function evaluateGame(
  pgn: string,
  engine: StockfishEngine,
  onProgress?: (ply: number, total: number) => void,
  playerColor?: "white" | "black",
): Promise<{ moves: MoveEval[]; summary: AnalysisSummary }> {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history();
  chess.reset();

  // Replay PGN header to get starting position
  const headerMatch = pgn.match(/\[FEN "([^"]+)"\]/);
  if (headerMatch) {
    chess.load(headerMatch[1]);
  } else {
    chess.reset();
  }

  const moves: MoveEval[] = [];

  for (let i = 0; i < history.length; i++) {
    const fen = chess.fen();
    const isWhiteTurn = chess.turn() === "w";

    // Evaluate position before the move
    // Engine returns eval from side-to-move's perspective; convert to white's
    const beforeResult = await engine.evaluate(fen, ANALYSIS_DEPTH);
    const evalBeforeWhite = isWhiteTurn ? beforeResult.eval : -beforeResult.eval;

    // Convert best move from UCI to SAN for display
    let bestMoveSan = beforeResult.bestMove;
    try {
      const tempChess = new Chess(fen);
      const from = beforeResult.bestMove.substring(0, 2);
      const to = beforeResult.bestMove.substring(2, 4);
      const promo = beforeResult.bestMove.length > 4 ? beforeResult.bestMove[4] : undefined;
      const bestMoveObj = tempChess.move({ from, to, promotion: promo as "q" | "r" | "b" | "n" | undefined });
      if (bestMoveObj) bestMoveSan = bestMoveObj.san;
    } catch {
      // Keep UCI notation as fallback
    }

    // Make the move
    const move = chess.move(history[i]);
    if (!move) break;

    // Evaluate position after the move (from white's perspective)
    // After the move, the side to move has flipped. Convert to white's perspective:
    // If white just moved → now black's turn → negate to get white's
    // If black just moved → now white's turn → already from white's
    const afterResult = await engine.evaluate(chess.fen(), ANALYSIS_DEPTH);
    const evalAfterWhite = isWhiteTurn ? -afterResult.eval : afterResult.eval;

    // Calculate eval delta FROM THE MOVING SIDE'S PERSPECTIVE
    // Positive delta = the move made things worse for the mover
    const evalBeforeForMover = isWhiteTurn ? evalBeforeWhite : -evalBeforeWhite;
    const evalAfterForMover = isWhiteTurn ? evalAfterWhite : -evalAfterWhite;
    const evalDelta = evalBeforeForMover - evalAfterForMover;

    // Classify the move
    let classification: MoveEval["classification"] = "normal";
    if (evalDelta >= BLUNDER_THRESHOLD) {
      classification = "blunder";
    } else if (evalDelta >= MISTAKE_THRESHOLD) {
      classification = "mistake";
    } else if (evalDelta >= INACCURACY_THRESHOLD) {
      classification = "inaccuracy";
    } else if (evalDelta <= -30) {
      classification = "great";
    } else if (evalDelta <= 0) {
      classification = "good";
    }

    moves.push({
      ply: i + 1,
      san: history[i],
      fen,
      eval: evalBeforeWhite,
      bestMove: beforeResult.bestMove,
      bestMoveSan,
      evalDelta,
      classification,
      exploitMove: afterResult.bestMove, // opponent's best response after this move
    });

    onProgress?.(i + 1, history.length);
  }

  const summary = computeSummary(moves, playerColor);

  return { moves, summary };
}

/**
 * Compute summary stats for the PLAYER only (not both sides).
 * Odd plies (1, 3, 5...) are white's moves; even plies (2, 4, 6...) are black's.
 */
function computeSummary(moves: MoveEval[], playerColor?: "white" | "black"): AnalysisSummary {
  let totalCPL = 0;
  let blunders = 0;
  let mistakes = 0;
  let inaccuracies = 0;
  let moveCount = 0;

  for (const move of moves) {
    // Only count the player's own moves for summary stats
    if (playerColor) {
      const isWhiteMove = move.ply % 2 === 1;
      const isPlayerMove =
        (playerColor === "white" && isWhiteMove) ||
        (playerColor === "black" && !isWhiteMove);
      if (!isPlayerMove) continue;
    }

    if (move.evalDelta > 0) {
      // Cap at 500cp so mate-score blunders don't dominate the average
      totalCPL += Math.min(move.evalDelta, 500);
    }
    moveCount++;

    if (move.classification === "blunder") blunders++;
    if (move.classification === "mistake") mistakes++;
    if (move.classification === "inaccuracy") inaccuracies++;
  }

  const averageCentipawnLoss =
    moveCount > 0 ? Math.round(totalCPL / moveCount) : 0;

  // Accuracy formula inspired by Lichess
  // accuracy ≈ 100 * e^(-0.004 * ACPL)
  const accuracy = Math.round(
    Math.min(100, Math.max(0, 100 * Math.exp(-0.004 * averageCentipawnLoss))),
  );

  return {
    averageCentipawnLoss,
    accuracy,
    blunders,
    mistakes,
    inaccuracies,
  };
}

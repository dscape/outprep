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
    const result = await engine.evaluate(fen, ANALYSIS_DEPTH);
    const evalFromWhite = result.eval;

    // Make the move
    const move = chess.move(history[i]);
    if (!move) break;

    // Evaluate position after the move
    const afterResult = await engine.evaluate(chess.fen(), ANALYSIS_DEPTH);
    const afterEval = afterResult.eval;

    // Calculate eval delta (from the moving side's perspective)
    const evalBefore = isWhiteTurn ? evalFromWhite : -evalFromWhite;
    const evalAfter = isWhiteTurn ? afterEval : -afterEval;
    const evalDelta = evalBefore - evalAfter;

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
      eval: evalFromWhite,
      bestMove: result.bestMove,
      evalDelta,
      classification,
    });

    onProgress?.(i + 1, history.length);
  }

  const summary = computeSummary(moves);

  return { moves, summary };
}

function computeSummary(moves: MoveEval[]): AnalysisSummary {
  let totalCPL = 0;
  let blunders = 0;
  let mistakes = 0;
  let inaccuracies = 0;
  let moveCount = 0;

  for (const move of moves) {
    if (move.evalDelta > 0) {
      totalCPL += move.evalDelta;
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

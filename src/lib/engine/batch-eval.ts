import { Chess } from "chess.js";
import { StockfishEngine } from "../stockfish-worker";
import { GameEvalData } from "../types";

/**
 * Batch evaluation modes:
 * - sampling: depth 10, every other player-move position, skip first 6 plies (~1-2 min for 300 games)
 * - comprehensive: depth 12, every player-move position (~3-5 min for 300 games)
 */
export type EvalMode = "sampling" | "comprehensive";

export interface BatchEvalProgress {
  gamesComplete: number;
  totalGames: number;
  evalsComplete: number;
  totalEvals: number;
}

const DEPTH: Record<EvalMode, number> = {
  sampling: 10,
  comprehensive: 12,
};

const SKIP_PLIES: Record<EvalMode, number> = {
  sampling: 6,    // skip first 3 full moves (opening theory)
  comprehensive: 4, // skip first 2 full moves
};

/** Milliseconds per eval at given depth (rough estimate for time display) */
const MS_PER_EVAL: Record<EvalMode, number> = {
  sampling: 40,
  comprehensive: 80,
};

/**
 * Estimate wall-clock time in seconds for a batch eval run.
 * Counts the number of positions that will actually be evaluated.
 */
export function estimateTime(
  gameCount: number,
  mode: EvalMode,
  avgMovesPerGame = 40
): number {
  const avgPlayerMoves = avgMovesPerGame / 2;
  const skipPlies = SKIP_PLIES[mode];
  const skippedPlayerMoves = Math.ceil(skipPlies / 2);
  const evalablePlayerMoves = Math.max(0, avgPlayerMoves - skippedPlayerMoves);

  let evalsPerGame: number;
  if (mode === "sampling") {
    // Every other player move
    evalsPerGame = Math.ceil(evalablePlayerMoves / 2);
  } else {
    evalsPerGame = evalablePlayerMoves;
  }

  const totalEvals = gameCount * evalsPerGame;
  return Math.ceil((totalEvals * MS_PER_EVAL[mode]) / 1000);
}

/**
 * Count total evals that will be performed (for progress tracking).
 */
function countTotalEvals(
  games: Array<{ moves: string; playerColor: "white" | "black" }>,
  mode: EvalMode
): number {
  const skipPlies = SKIP_PLIES[mode];
  let total = 0;

  for (const game of games) {
    if (!game.moves) continue;
    const moves = game.moves.split(" ");
    const isWhite = game.playerColor === "white";
    let playerMovesSeen = 0;

    for (let ply = 0; ply < moves.length; ply++) {
      if (ply < skipPlies) continue;

      const isWhiteMove = ply % 2 === 0;
      const isPlayerMove =
        (isWhite && isWhiteMove) || (!isWhite && !isWhiteMove);

      if (isPlayerMove) {
        playerMovesSeen++;
        if (mode === "sampling" && playerMovesSeen % 2 === 0) continue;
        total++;
      }
    }
  }

  return total;
}

/**
 * Batch evaluate positions from multiple games using Stockfish.
 *
 * For each game, replays moves and evaluates the position before each
 * of the player's moves. Returns eval data in a format compatible with
 * `buildErrorProfileFromEvals`.
 */
export async function batchEvaluateGames(
  engine: StockfishEngine,
  games: Array<{ moves: string; playerColor: "white" | "black" }>,
  mode: EvalMode,
  onProgress: (progress: BatchEvalProgress) => void,
  signal?: AbortSignal
): Promise<GameEvalData[]> {
  const depth = DEPTH[mode];
  const skipPlies = SKIP_PLIES[mode];
  const totalEvals = countTotalEvals(games, mode);

  let evalsComplete = 0;
  let gamesComplete = 0;
  const results: GameEvalData[] = [];

  for (const game of games) {
    if (signal?.aborted) break;

    // Fire progress at game start for immediate feedback
    onProgress({ gamesComplete, totalGames: games.length, evalsComplete, totalEvals });

    if (!game.moves) {
      gamesComplete++;
      continue;
    }

    const moves = game.moves.split(" ");
    const isWhite = game.playerColor === "white";
    const chess = new Chess();

    // evals[ply] = centipawns from white's perspective after ply
    // We fill in only the positions we evaluate; others stay as NaN
    const evals: number[] = new Array(moves.length).fill(NaN);

    // Start position eval (before any moves)
    // Standard starting position is ~+15cp for white
    let lastEval = 15;
    let playerMovesSeen = 0;

    for (let ply = 0; ply < moves.length; ply++) {
      if (signal?.aborted) break;

      const isWhiteMove = ply % 2 === 0;
      const isPlayerMove =
        (isWhite && isWhiteMove) || (!isWhite && !isWhiteMove);

      if (isPlayerMove && ply >= skipPlies) {
        playerMovesSeen++;

        // In sampling mode, skip every other player move
        const shouldEval =
          mode === "comprehensive" || playerMovesSeen % 2 === 1;

        if (shouldEval) {
          try {
            // Evaluate position BEFORE this move (what the player saw)
            const result = await engine.evaluate(chess.fen(), depth);
            lastEval = result.eval;

            // Store eval before this ply
            if (ply > 0) {
              evals[ply - 1] = lastEval;
            }

            evalsComplete++;
            onProgress({
              gamesComplete,
              totalGames: games.length,
              evalsComplete,
              totalEvals,
            });
          } catch {
            // Engine error — skip this position
          }
        }
      }

      // Play the move to advance position
      try {
        chess.move(moves[ply]);

        // If we just evaluated before a player move, now evaluate after
        // to get the CPL delta
        const isPlayerMoveJustPlayed =
          (isWhite && isWhiteMove) || (!isWhite && !isWhiteMove);

        if (
          isPlayerMoveJustPlayed &&
          ply >= skipPlies &&
          !isNaN(evals[ply > 0 ? ply - 1 : 0])
        ) {
          try {
            const afterResult = await engine.evaluate(chess.fen(), depth);
            evals[ply] = afterResult.eval;
          } catch {
            evals[ply] = lastEval; // fallback to previous eval
          }
        }
      } catch {
        break; // Invalid move, stop processing this game
      }
    }

    results.push({
      moves: game.moves,
      playerColor: game.playerColor,
      evals,
    });

    gamesComplete++;
    onProgress({
      gamesComplete,
      totalGames: games.length,
      evalsComplete,
      totalEvals,
    });
  }

  return results;
}

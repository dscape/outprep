import { Chess } from "chess.js";
import type { ErrorProfile, PhaseErrors, GameEvalData, GamePhase, BotConfig } from "./types";
import { detectPhaseFromBoard } from "./phase-detector";
import { DEFAULT_CONFIG } from "./config";

/**
 * Build an error profile from generic eval data (source-agnostic).
 *
 * Works with evals from batch-eval (client-side Stockfish), Lichess annotations,
 * or any other source that provides per-ply centipawn evaluations.
 *
 * evals[i] = centipawns from white's perspective after ply i.
 * NaN values are skipped (positions that weren't evaluated).
 */
export function buildErrorProfileFromEvals(
  evalData: GameEvalData[],
  config: Pick<BotConfig, "error" | "phase"> = DEFAULT_CONFIG
): ErrorProfile {
  const accumulators: Record<GamePhase | "overall", PhaseAccumulator> = {
    opening: createAccumulator(),
    middlegame: createAccumulator(),
    endgame: createAccumulator(),
    overall: createAccumulator(),
  };

  let gamesAnalyzed = 0;

  for (const game of evalData) {
    if (!game.moves || game.evals.length === 0) continue;

    const isWhite = game.playerColor === "white";
    const moveSans = game.moves.split(" ");
    let hasEvalData = false;

    const chess = new Chess();

    for (let ply = 0; ply < moveSans.length; ply++) {
      const isWhiteMove = ply % 2 === 0;
      const isPlayerMove =
        (isWhite && isWhiteMove) || (!isWhite && !isWhiteMove);

      if (!isPlayerMove) {
        try {
          chess.move(moveSans[ply]);
        } catch {
          break;
        }
        continue;
      }

      // Need eval before and after this move
      // evals[ply-1] = eval after previous ply (= eval before this move)
      // evals[ply] = eval after this ply (= eval after this move)
      const cpBefore = ply > 0 ? game.evals[ply - 1] : 15; // starting position ~+15cp
      const cpAfter = game.evals[ply];

      // Skip if either eval is missing (NaN from un-evaluated positions)
      if ((ply > 0 && isNaN(cpBefore)) || isNaN(cpAfter)) {
        try {
          chess.move(moveSans[ply]);
        } catch {
          break;
        }
        continue;
      }

      hasEvalData = true;

      // Detect phase BEFORE the move
      const phase = detectPhaseFromBoard(chess, config);

      // CPL from the perspective of the moving side
      const cpLoss = isWhiteMove
        ? Math.max(0, cpBefore - cpAfter)
        : Math.max(0, cpAfter - cpBefore);

      addMove(accumulators[phase], cpLoss, config);
      addMove(accumulators.overall, cpLoss, config);

      try {
        chess.move(moveSans[ply]);
      } catch {
        break;
      }
    }

    if (hasEvalData) gamesAnalyzed++;
  }

  return {
    opening: finalizePhase(accumulators.opening),
    middlegame: finalizePhase(accumulators.middlegame),
    endgame: finalizePhase(accumulators.endgame),
    overall: finalizePhase(accumulators.overall),
    gamesAnalyzed,
  };
}

/* ── Internal helpers ──────────────────────────────────────── */

interface PhaseAccumulator {
  totalMoves: number;
  mistakes: number;
  blunders: number;
  totalCPL: number;
}

function createAccumulator(): PhaseAccumulator {
  return { totalMoves: 0, mistakes: 0, blunders: 0, totalCPL: 0 };
}

function addMove(
  acc: PhaseAccumulator,
  cpLoss: number,
  config: Pick<BotConfig, "error">
): void {
  acc.totalMoves++;
  acc.totalCPL += cpLoss;

  if (cpLoss >= config.error.blunder) {
    acc.blunders++;
  } else if (cpLoss >= config.error.mistake) {
    acc.mistakes++;
  }
}

function finalizePhase(acc: PhaseAccumulator): PhaseErrors {
  const totalErrors = acc.mistakes + acc.blunders;
  return {
    totalMoves: acc.totalMoves,
    mistakes: acc.mistakes,
    blunders: acc.blunders,
    avgCPL: acc.totalMoves > 0 ? Math.round(acc.totalCPL / acc.totalMoves) : 0,
    errorRate: acc.totalMoves > 0 ? totalErrors / acc.totalMoves : 0,
    blunderRate: acc.totalMoves > 0 ? acc.blunders / acc.totalMoves : 0,
  };
}

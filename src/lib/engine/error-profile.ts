import { Chess } from "chess.js";
import { LichessGame, ErrorProfile, PhaseErrors, LichessEvalAnnotation } from "../types";
import { detectPhaseFromBoard, GamePhase } from "./phase-detector";

/**
 * Build a per-phase error profile from the opponent's Lichess games.
 *
 * Uses the Lichess eval annotations that come with games (evals=true) —
 * does NOT re-analyze with local Stockfish.
 *
 * For each of the opponent's moves in their game history:
 *   - Compute centipawn loss from eval before vs eval after the move
 *   - Detect game phase at that position via material counting
 *   - Classify: inaccuracy (50-100cp), mistake (100-300cp), blunder (300+cp)
 *   - Accumulate per phase
 */
export function buildErrorProfile(
  games: LichessGame[],
  username: string
): ErrorProfile {
  const accumulators: Record<GamePhase | "overall", PhaseAccumulator> = {
    opening: createAccumulator(),
    middlegame: createAccumulator(),
    endgame: createAccumulator(),
    overall: createAccumulator(),
  };

  let gamesAnalyzed = 0;

  for (const game of games) {
    if (!game.analysis || game.analysis.length === 0) continue;
    if (!game.moves || game.variant !== "standard") continue;

    const isWhite =
      game.players.white?.user?.id?.toLowerCase() === username.toLowerCase();
    const moveSans = game.moves.split(" ");

    gamesAnalyzed++;

    const chess = new Chess();

    for (let ply = 0; ply < moveSans.length; ply++) {
      const isWhiteMove = ply % 2 === 0;
      const isPlayerMove =
        (isWhite && isWhiteMove) || (!isWhite && !isWhiteMove);

      // Only count the opponent's moves (we're profiling their errors)
      if (!isPlayerMove) {
        try {
          chess.move(moveSans[ply]);
        } catch {
          break;
        }
        continue;
      }

      // We need eval before and after this move
      // Lichess analysis array: index i = eval AFTER ply i (0-indexed)
      // So eval before ply i = analysis[i-1], eval after ply i = analysis[i]
      const evalBefore = ply > 0 ? game.analysis[ply - 1] : undefined;
      const evalAfter = game.analysis[ply];

      if (!evalBefore && ply > 0) {
        try { chess.move(moveSans[ply]); } catch { break; }
        continue;
      }
      if (!evalAfter) {
        try { chess.move(moveSans[ply]); } catch { break; }
        continue;
      }

      // Detect phase BEFORE the move is played
      const phase = detectPhaseFromBoard(chess);

      // Compute centipawn loss
      const cpBefore = evalToCp(ply === 0 ? { eval: 15 } : evalBefore!);
      const cpAfter = evalToCp(evalAfter);

      // CPL from the perspective of the moving side:
      // If white moves: loss = cpBefore - cpAfter (white's eval should stay same or go up)
      // If black moves: loss = cpAfter - cpBefore (black wants eval to go DOWN from white perspective)
      const cpLoss = isWhiteMove
        ? Math.max(0, cpBefore - cpAfter)
        : Math.max(0, cpAfter - cpBefore);

      // Accumulate into the right phase bucket + overall
      addMove(accumulators[phase], cpLoss);
      addMove(accumulators.overall, cpLoss);

      try {
        chess.move(moveSans[ply]);
      } catch {
        break;
      }
    }
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
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  totalCPL: number;
}

function createAccumulator(): PhaseAccumulator {
  return { totalMoves: 0, inaccuracies: 0, mistakes: 0, blunders: 0, totalCPL: 0 };
}

function addMove(acc: PhaseAccumulator, cpLoss: number): void {
  acc.totalMoves++;
  acc.totalCPL += cpLoss;

  if (cpLoss >= 300) {
    acc.blunders++;
  } else if (cpLoss >= 100) {
    acc.mistakes++;
  } else if (cpLoss >= 50) {
    acc.inaccuracies++;
  }
}

function finalizePhase(acc: PhaseAccumulator): PhaseErrors {
  const totalErrors = acc.inaccuracies + acc.mistakes + acc.blunders;
  return {
    totalMoves: acc.totalMoves,
    inaccuracies: acc.inaccuracies,
    mistakes: acc.mistakes,
    blunders: acc.blunders,
    avgCPL: acc.totalMoves > 0 ? Math.round(acc.totalCPL / acc.totalMoves) : 0,
    errorRate: acc.totalMoves > 0 ? totalErrors / acc.totalMoves : 0,
    blunderRate: acc.totalMoves > 0 ? acc.blunders / acc.totalMoves : 0,
  };
}

/**
 * Convert a Lichess eval annotation to centipawns from white's perspective.
 * Mate scores are clamped to ±10000cp to avoid dominating averages.
 */
function evalToCp(annotation: LichessEvalAnnotation): number {
  if (annotation.eval !== undefined) return annotation.eval;
  if (annotation.mate !== undefined) {
    // mate > 0 means white is mating, treat as large positive
    return annotation.mate > 0 ? 10000 : -10000;
  }
  return 0;
}

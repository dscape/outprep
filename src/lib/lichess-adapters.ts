/**
 * Adapters that convert Lichess-specific data types to the
 * platform-agnostic types used by @outprep/engine.
 */

import type { GameRecord, GameEvalData, ErrorProfile } from "@outprep/engine";
import { buildErrorProfileFromEvals } from "@outprep/engine";
import type { LichessGame, LichessEvalAnnotation } from "./types";

/**
 * Convert a LichessGame to a GameRecord for opening trie building.
 */
export function lichessGameToGameRecord(
  game: LichessGame,
  username: string
): GameRecord {
  const isWhite =
    game.players.white?.user?.id?.toLowerCase() === username.toLowerCase();
  return {
    moves: game.moves,
    playerColor: isWhite ? "white" : "black",
    result: game.winner
      ? game.winner
      : game.status === "draw" || game.status === "stalemate"
        ? "draw"
        : undefined,
  };
}

/**
 * Convert a Lichess eval annotation to centipawns from white's perspective.
 * Mate scores are clamped to ±10000cp.
 */
function evalToCp(annotation: LichessEvalAnnotation): number {
  if (annotation.eval !== undefined) return annotation.eval;
  if (annotation.mate !== undefined) {
    return annotation.mate > 0 ? 10000 : -10000;
  }
  return 0;
}

/**
 * Convert a LichessGame (with eval annotations) to a GameEvalData
 * for error profile building.
 */
export function lichessGameToEvalData(
  game: LichessGame,
  username: string
): GameEvalData | null {
  if (!game.analysis || game.analysis.length === 0) return null;
  if (!game.moves || game.variant !== "standard") return null;

  const isWhite =
    game.players.white?.user?.id?.toLowerCase() === username.toLowerCase();

  // Convert Lichess annotations to a flat evals array.
  // evals[i] = centipawns from white's perspective after ply i.
  const evals: number[] = [];
  for (let i = 0; i < game.analysis.length; i++) {
    const annotation = game.analysis[i];
    if (annotation) {
      evals.push(evalToCp(annotation));
    } else {
      evals.push(NaN);
    }
  }

  return {
    moves: game.moves,
    playerColor: isWhite ? "white" : "black",
    evals,
  };
}

/**
 * Build an error profile from Lichess games (convenience wrapper).
 * Converts LichessGame[] → GameEvalData[] → ErrorProfile via the engine.
 */
export function buildErrorProfileFromLichess(
  games: LichessGame[],
  username: string
): ErrorProfile {
  const evalData: GameEvalData[] = [];
  for (const game of games) {
    const data = lichessGameToEvalData(game, username);
    if (data) evalData.push(data);
  }
  return buildErrorProfileFromEvals(evalData);
}

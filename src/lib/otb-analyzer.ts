import { OTBGame, OTBProfile, LichessGame } from "./types";
import {
  analyzeStyle,
  analyzeOpenings,
  detectWeaknesses,
} from "./profile-builder";

/**
 * Analyze OTB games using the same analysis functions as Lichess games.
 * Converts OTBGame[] to LichessGame[] format (thin adapter) and runs
 * analyzeStyle, analyzeOpenings, and detectWeaknesses.
 */
export function analyzeOTBGames(
  games: OTBGame[],
  playerName: string
): OTBProfile {
  // Resolve the exact player name string used in the PGN White/Black fields
  const username = resolvePlayerName(games, playerName);

  // Convert OTB games to LichessGame-compatible format
  const converted: LichessGame[] = games.map((g, i) =>
    adaptOTBToLichess(g, i)
  );

  const style = analyzeStyle(converted, username);
  const openings = analyzeOpenings(converted, username);
  const weaknesses = detectWeaknesses(
    converted,
    username,
    style,
    openings,
    converted.length
  );

  return {
    games,
    totalGames: games.length,
    style,
    openings,
    weaknesses,
  };
}

/**
 * Convert an OTBGame to the LichessGame shape expected by the analysis functions.
 * All OTB games are treated as classical, rated, standard variant.
 */
function adaptOTBToLichess(
  game: OTBGame,
  index: number,
): LichessGame {
  return {
    id: `otb-${index}`,
    rated: true,
    variant: "standard",
    speed: "classical",
    perf: "classical",
    status: game.result === "1/2-1/2" ? "draw" : "mate",
    players: {
      white: {
        user: {
          name: game.white,
          id: game.white.toLowerCase().replace(/[^a-z0-9]/g, ""),
        },
        rating: 0,
      },
      black: {
        user: {
          name: game.black,
          id: game.black.toLowerCase().replace(/[^a-z0-9]/g, ""),
        },
        rating: 0,
      },
    },
    winner:
      game.result === "1-0"
        ? "white"
        : game.result === "0-1"
          ? "black"
          : undefined,
    opening:
      game.eco || game.opening
        ? {
            eco: game.eco || "",
            name: game.opening || game.eco || "Unknown",
            ply: 0,
          }
        : undefined,
    moves: game.moves,
  };
}

/**
 * Find the exact player name string as it appears in the PGN White/Black fields.
 * Uses case-insensitive substring matching and returns the most common match.
 */
function resolvePlayerName(games: OTBGame[], playerName: string): string {
  const lower = playerName.toLowerCase();
  const counts = new Map<string, number>();

  for (const g of games) {
    if (g.white.toLowerCase().includes(lower)) {
      const id = g.white.toLowerCase().replace(/[^a-z0-9]/g, "");
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    if (g.black.toLowerCase().includes(lower)) {
      const id = g.black.toLowerCase().replace(/[^a-z0-9]/g, "");
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }

  // Return the most frequently matched player ID
  let bestId = playerName.toLowerCase().replace(/[^a-z0-9]/g, "");
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }

  return bestId;
}

import { OTBGame, PlayerProfile } from "./types";
import {
  analyzeStyle,
  analyzeOpenings,
  detectWeaknesses,
  generatePrepTips,
} from "./profile-builder";
import { fromOTBGame } from "./normalized-game";

/**
 * Analyze OTB games using the unified NormalizedGame pipeline.
 * Returns a PlayerProfile with platform: "pgn".
 */
export function analyzeOTBGames(
  games: OTBGame[],
  playerName: string
): PlayerProfile {
  const username = resolvePlayerName(games, playerName);
  const normalized = games.map((g, i) => fromOTBGame(g, username, i));

  const style = analyzeStyle(normalized);
  const openings = analyzeOpenings(normalized, 1);
  const weaknesses = detectWeaknesses(normalized, style, openings, normalized.length);
  const prepTips = generatePrepTips(weaknesses, openings, style);

  return {
    username,
    platform: "pgn",
    totalGames: games.length,
    analyzedGames: games.length,
    style,
    weaknesses,
    openings,
    prepTips,
    lastComputed: Date.now(),
    games,
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

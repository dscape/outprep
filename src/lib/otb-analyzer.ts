import { OTBGame, PlayerProfile, SpeedProfile } from "./types";
import {
  analyzeStyle,
  analyzeOpenings,
  detectWeaknesses,
  generatePrepTips,
} from "./profile-builder";
import { fromOTBGame } from "./normalized-game";
import type { NormalizedGame } from "./normalized-game";

/**
 * Analyze OTB games using the unified NormalizedGame pipeline.
 * Returns a PlayerProfile with platform: "pgn" and per-speed breakdowns.
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

  // Per-speed breakdowns (same pattern as buildProfile in profile-builder.ts)
  const bySpeed: Record<string, SpeedProfile> = {};
  const speedGroups = new Map<string, NormalizedGame[]>();
  for (const g of normalized) {
    if (!g.speed) continue;
    const arr = speedGroups.get(g.speed) || [];
    arr.push(g);
    speedGroups.set(g.speed, arr);
  }
  for (const [speed, speedGames] of speedGroups) {
    const speedStyle = analyzeStyle(speedGames);
    const speedOpenings = analyzeOpenings(speedGames);
    const speedWeaknesses = detectWeaknesses(speedGames, speedStyle, speedOpenings, speedGames.length);
    bySpeed[speed] = {
      games: speedGames.length,
      style: speedStyle,
      openings: speedOpenings,
      weaknesses: speedWeaknesses,
    };
  }

  return {
    username,
    platform: "pgn",
    totalGames: games.length,
    analyzedGames: games.length,
    style,
    weaknesses,
    openings,
    prepTips,
    bySpeed,
    lastComputed: Date.now(),
    games,
  };
}

/**
 * Find the exact player name string as it appears in the PGN White/Black fields.
 * Uses case-insensitive substring matching and returns the most common match.
 * Also handles slug-format names (e.g., "arif-abdul-hafiz-7104227") by extracting
 * name parts and matching them against PGN player names.
 */
// Re-export from engine package — canonical implementation lives there
import { matchesPlayerName } from "@outprep/engine";
export { matchesPlayerName };

function resolvePlayerName(games: OTBGame[], playerName: string): string {
  const lower = playerName.toLowerCase();
  // counts maps alphanumeric ID → { count, originalName }
  const counts = new Map<string, { count: number; name: string }>();

  function nameMatches(pgnName: string): boolean {
    return matchesPlayerName(pgnName, lower);
  }

  for (const g of games) {
    if (nameMatches(g.white)) {
      const id = g.white.toLowerCase().replace(/[^a-z0-9]/g, "");
      const entry = counts.get(id) || { count: 0, name: g.white };
      entry.count++;
      counts.set(id, entry);
    }
    if (nameMatches(g.black)) {
      const id = g.black.toLowerCase().replace(/[^a-z0-9]/g, "");
      const entry = counts.get(id) || { count: 0, name: g.black };
      entry.count++;
      counts.set(id, entry);
    }
  }

  let bestId = playerName.toLowerCase().replace(/[^a-z0-9]/g, "");
  let bestName = playerName;
  let bestCount = 0;
  for (const [id, { count, name }] of counts) {
    if (count > bestCount) {
      bestId = id;
      bestName = name;
      bestCount = count;
    }
  }

  return bestName;
}

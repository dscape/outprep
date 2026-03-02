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
function resolvePlayerName(games: OTBGame[], playerName: string): string {
  const lower = playerName.toLowerCase();
  // counts maps alphanumeric ID → { count, originalName }
  const counts = new Map<string, { count: number; name: string }>();

  // Extract name words from the input (handles slug format with trailing FIDE ID)
  const slugParts = lower.split(/[-\s,]+/).filter(Boolean);
  // Remove trailing numeric FIDE ID if present
  const nameWords = slugParts.filter(p => !/^\d{4,}$/.test(p));

  function nameMatches(pgnName: string): boolean {
    const pgnLower = pgnName.toLowerCase();
    // Direct substring match
    if (pgnLower.includes(lower)) return true;
    // Reverse alphanumeric substring match — handles abbreviated FIDE names
    // e.g. PGN "Caruana,F" → "caruanaf", player "Caruana, Fabiano" → "caruanafabiano"
    const pgnAlpha = pgnLower.replace(/[^a-z0-9]/g, "");
    const playerAlpha = lower.replace(/[^a-z0-9]/g, "");
    if (pgnAlpha.length >= 4 && playerAlpha.includes(pgnAlpha)) return true;
    // Word-based match: all name words appear in the PGN name
    if (nameWords.length >= 2) {
      const pgnNormalized = pgnLower.replace(/[^a-z\s]/g, " ");
      return nameWords.every(w => pgnNormalized.includes(w));
    }
    return false;
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

/**
 * Player pool management — Elo-stratified player discovery and management.
 *
 * Maintains a pool of Lichess players across Elo bands so the tuner
 * can test configs against diverse play styles and skill levels.
 */

import { fetchLichessUser } from "@outprep/harness";
import type { PlayerEntry, EloBand, TunerState } from "../state/types";
import { ELO_BANDS } from "../state/types";

/**
 * Classify a player's Elo into a band.
 */
export function classifyEloBand(elo: number): EloBand {
  if (elo < 1400) return "beginner";
  if (elo < 1700) return "intermediate";
  if (elo < 2000) return "advanced";
  if (elo < 2300) return "expert";
  return "master";
}

/**
 * Get players for a given band from the pool.
 */
export function getPlayersForBand(
  pool: PlayerEntry[],
  band: EloBand
): PlayerEntry[] {
  return pool.filter((p) => p.band === band);
}

/**
 * Check which bands need more players.
 */
export function getBandsNeedingPlayers(
  pool: PlayerEntry[]
): { band: EloBand; needed: number }[] {
  const needs: { band: EloBand; needed: number }[] = [];

  for (const [band, config] of Object.entries(ELO_BANDS)) {
    const current = pool.filter((p) => p.band === band).length;
    if (current < config.targetPlayers) {
      needs.push({ band: band as EloBand, needed: config.targetPlayers - current });
    }
  }

  return needs;
}

/**
 * Validate a player exists on Lichess and update their Elo.
 * Returns updated entry or null if player not found.
 */
export async function validatePlayer(
  entry: PlayerEntry
): Promise<PlayerEntry | null> {
  try {
    const user = await fetchLichessUser(entry.username);
    if (!user) return null;

    // Pick the best available Elo from their perfs
    const perfs = user.perfs;
    const elos: number[] = [];
    if (perfs?.rapid?.rating) elos.push(perfs.rapid.rating);
    if (perfs?.blitz?.rating) elos.push(perfs.blitz.rating);
    if (perfs?.classical?.rating) elos.push(perfs.classical.rating);
    if (perfs?.bullet?.rating) elos.push(perfs.bullet.rating);

    const estimatedElo =
      elos.length > 0
        ? Math.round(elos.reduce((a, b) => a + b, 0) / elos.length)
        : entry.estimatedElo;

    return {
      ...entry,
      username: user.username,
      estimatedElo,
      band: classifyEloBand(estimatedElo),
    };
  } catch {
    return null;
  }
}

/**
 * Validate all players in the pool, removing those that can't be found.
 */
export async function validatePool(
  pool: PlayerEntry[],
  onProgress?: (validated: number, total: number) => void
): Promise<PlayerEntry[]> {
  const validated: PlayerEntry[] = [];

  for (let i = 0; i < pool.length; i++) {
    const result = await validatePlayer(pool[i]);
    if (result) {
      validated.push(result);
    } else {
      console.log(`  Removed ${pool[i].username} (not found on Lichess)`);
    }

    if (onProgress) onProgress(i + 1, pool.length);

    // Rate limit: 1.5s between Lichess API calls
    if (i < pool.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  return validated;
}

/**
 * Add a player to the pool if not already present.
 */
export function addPlayer(
  pool: PlayerEntry[],
  entry: PlayerEntry
): PlayerEntry[] {
  const exists = pool.some(
    (p) => p.username.toLowerCase() === entry.username.toLowerCase()
  );
  if (exists) return pool;
  return [...pool, entry];
}

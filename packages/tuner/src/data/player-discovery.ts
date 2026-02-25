/**
 * Player discovery — mines opponents from fetched games to fill
 * under-represented Elo bands in the player pool.
 *
 * After datasets are created for seed players, this module scans
 * their games to find active opponents at target rating ranges.
 * This naturally fills beginner/intermediate bands that are hard
 * to seed by hand, using real active players from the same time
 * controls.
 */

import type { LichessGame } from "@outprep/harness";
import type { PlayerEntry, EloBand } from "../state/types";
import { ELO_BANDS } from "../state/types";
import { classifyEloBand } from "./player-pool";

interface OpponentInfo {
  username: string;
  rating: number;
  /** How many games we saw this opponent in (prefer frequent opponents). */
  gameCount: number;
}

/**
 * Extract opponents from fetched games, excluding players already in pool.
 * Returns opponents sorted by game count (most active first).
 */
export function extractOpponents(
  games: LichessGame[],
  knownUsername: string,
  excludeUsernames: Set<string>
): OpponentInfo[] {
  const opponentMap = new Map<string, { ratings: number[]; id: string }>();

  for (const game of games) {
    const white = game.players.white;
    const black = game.players.black;

    if (!white?.user?.id || !black?.user?.id) continue;

    // Figure out which side is the known player and which is the opponent
    const isWhite = white.user.id.toLowerCase() === knownUsername.toLowerCase();
    const opponent = isWhite ? black : white;

    const oppId = opponent.user!.id;
    const oppRating = opponent.rating;

    if (!oppId || !oppRating) continue;
    if (excludeUsernames.has(oppId.toLowerCase())) continue;

    const existing = opponentMap.get(oppId.toLowerCase());
    if (existing) {
      existing.ratings.push(oppRating);
    } else {
      opponentMap.set(oppId.toLowerCase(), {
        id: oppId,
        ratings: [oppRating],
      });
    }
  }

  return Array.from(opponentMap.values())
    .map((opp) => ({
      username: opp.id,
      rating: Math.round(
        opp.ratings.reduce((a, b) => a + b, 0) / opp.ratings.length
      ),
      gameCount: opp.ratings.length,
    }))
    .sort((a, b) => b.gameCount - a.gameCount);
}

/**
 * Extract opponents from ALL datasets' games (multiple known players).
 */
export function extractAllOpponents(
  gamesByPlayer: { username: string; games: LichessGame[] }[],
  excludeUsernames: Set<string>
): OpponentInfo[] {
  const allOpponents = new Map<string, OpponentInfo>();

  for (const { username, games } of gamesByPlayer) {
    const opponents = extractOpponents(games, username, excludeUsernames);
    for (const opp of opponents) {
      const key = opp.username.toLowerCase();
      const existing = allOpponents.get(key);
      if (existing) {
        existing.gameCount += opp.gameCount;
        // Weighted average rating
        existing.rating = Math.round(
          (existing.rating * (existing.gameCount - opp.gameCount) +
            opp.rating * opp.gameCount) /
            existing.gameCount
        );
      } else {
        allOpponents.set(key, { ...opp });
      }
    }
  }

  return Array.from(allOpponents.values()).sort(
    (a, b) => b.gameCount - a.gameCount
  );
}

/**
 * Pick the best opponents to fill under-represented Elo bands.
 *
 * For each band that needs more players, picks opponents whose rating
 * falls within the band's [min, max) range. Prefers opponents with
 * more game appearances (more active = better data quality).
 *
 * @param maxPerBand — max opponents to add per band (default: 2)
 */
export function pickOpponentsForBands(
  opponents: OpponentInfo[],
  currentPool: PlayerEntry[],
  maxPerBand = 2
): PlayerEntry[] {
  const discovered: PlayerEntry[] = [];
  const poolUsernames = new Set(
    currentPool.map((p) => p.username.toLowerCase())
  );

  // Count current players per band
  const bandCounts = new Map<EloBand, number>();
  for (const player of currentPool) {
    bandCounts.set(player.band, (bandCounts.get(player.band) ?? 0) + 1);
  }

  // For each band, find needed opponents
  for (const [band, config] of Object.entries(ELO_BANDS) as [
    EloBand,
    (typeof ELO_BANDS)[EloBand],
  ][]) {
    const current = bandCounts.get(band) ?? 0;
    const needed = Math.min(maxPerBand, config.targetPlayers - current);
    if (needed <= 0) continue;

    // Find opponents in this band's rating range
    const candidates = opponents.filter(
      (opp) =>
        opp.rating >= config.min &&
        opp.rating < config.max &&
        !poolUsernames.has(opp.username.toLowerCase())
    );

    // Take the most active opponents
    for (const opp of candidates.slice(0, needed)) {
      const entry: PlayerEntry = {
        username: opp.username,
        band: classifyEloBand(opp.rating),
        estimatedElo: opp.rating,
      };
      discovered.push(entry);
      poolUsernames.add(opp.username.toLowerCase());
    }
  }

  return discovered;
}

/**
 * Chess.com Published Data API client.
 *
 * Uses the free, no-auth public API:
 * - GET /pub/player/{username} — profile
 * - GET /pub/player/{username}/stats — ratings
 * - GET /pub/player/{username}/games/archives — monthly archive list
 * - GET /pub/player/{username}/games/{YYYY}/{MM} — games for a month
 */

import type { ChesscomUser, ChesscomStats, ChesscomGame } from "./types";

const API = "https://api.chess.com/pub";

async function chesscomFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) throw new Error(`Player not found on Chess.com`);
  if (res.status === 429) throw new Error("Rate limited by Chess.com. Please try again in a minute.");
  if (!res.ok) throw new Error(`Chess.com API error: ${res.status}`);
  return res.json();
}

export async function fetchChesscomUser(username: string): Promise<ChesscomUser> {
  return chesscomFetch<ChesscomUser>(`${API}/player/${username.toLowerCase()}`);
}

export async function fetchChesscomStats(username: string): Promise<ChesscomStats> {
  return chesscomFetch<ChesscomStats>(`${API}/player/${username.toLowerCase()}/stats`);
}

/**
 * Fetch games from Chess.com, optionally only after a given timestamp.
 * Fetches monthly archives in reverse chronological order, stopping when
 * all games in a month are older than `since`.
 */
export async function fetchChesscomGames(
  username: string,
  max = 200,
  since?: number,
): Promise<ChesscomGame[]> {
  const lower = username.toLowerCase();

  // Get list of monthly archive URLs
  const { archives } = await chesscomFetch<{ archives: string[] }>(
    `${API}/player/${lower}/games/archives`,
  );

  if (!archives || archives.length === 0) return [];

  // Process archives in reverse (newest first)
  const games: ChesscomGame[] = [];
  const reversed = [...archives].reverse();

  for (const archiveUrl of reversed) {
    if (games.length >= max) break;

    const { games: monthGames } = await chesscomFetch<{ games: ChesscomGame[] }>(archiveUrl);
    if (!monthGames) continue;

    // Filter: only standard chess, rated, with PGN
    const valid = monthGames.filter(
      (g) => g.rules === "chess" && g.rated && g.pgn,
    );

    // Sort newest first within the month
    valid.sort((a, b) => b.end_time - a.end_time);

    for (const g of valid) {
      if (since && g.end_time * 1000 < since) {
        // All remaining games in older archives will be older too
        return games.slice(0, max);
      }
      games.push(g);
      if (games.length >= max) break;
    }

    // If oldest game in this month is before `since`, no need to check older archives
    if (since && valid.length > 0 && valid[valid.length - 1].end_time * 1000 < since) {
      break;
    }
  }

  return games.slice(0, max);
}

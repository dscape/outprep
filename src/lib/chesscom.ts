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
 * Fetches monthly archives in reverse chronological order (3 at a time),
 * stopping when all games in a batch are older than `since`.
 */
export async function fetchChesscomGames(
  username: string,
  max = 2000,
  since?: number,
): Promise<ChesscomGame[]> {
  const lower = username.toLowerCase();

  // Get list of monthly archive URLs
  const { archives } = await chesscomFetch<{ archives: string[] }>(
    `${API}/player/${lower}/games/archives`,
  );

  if (!archives || archives.length === 0) return [];

  // Process archives in reverse (newest first), 3 at a time for speed
  const games: ChesscomGame[] = [];
  const reversed = [...archives].reverse();
  const BATCH_SIZE = 3;
  let hitSinceCutoff = false;

  for (let i = 0; i < reversed.length && games.length < max && !hitSinceCutoff; i += BATCH_SIZE) {
    const batch = reversed.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((url) =>
        chesscomFetch<{ games: ChesscomGame[] }>(url).catch(() => ({ games: [] as ChesscomGame[] })),
      ),
    );

    for (const { games: monthGames } of results) {
      if (games.length >= max || hitSinceCutoff) break;
      if (!monthGames) continue;

      // Filter: only standard chess, rated, with PGN
      const valid = monthGames.filter(
        (g) => g.rules === "chess" && g.rated && g.pgn,
      );

      // Sort newest first within the month
      valid.sort((a, b) => b.end_time - a.end_time);

      for (const g of valid) {
        if (since && g.end_time * 1000 < since) {
          hitSinceCutoff = true;
          break;
        }
        games.push(g);
        if (games.length >= max) break;
      }
    }
  }

  return games.slice(0, max);
}

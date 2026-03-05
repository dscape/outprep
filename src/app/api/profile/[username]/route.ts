import { NextRequest, NextResponse } from "next/server";
import { fetchLichessUser, fetchLichessGames } from "@/lib/lichess";
import { buildProfile } from "@/lib/profile-builder";
import { fromLichessGame } from "@/lib/normalized-game";
import type { LichessUser, LichessGame } from "@/lib/types";
import {
  getCachedOnlinePlayer,
  upsertCachedOnlinePlayer,
  getLatestOnlineGameTime,
  insertOnlineGames,
  getCachedOnlineGames,
} from "@/lib/db";

// Simple in-memory cache (for profile results, not raw data)
const cache = new Map<string, { data: unknown; expires: number }>();
const TTL = 60 * 60 * 1000; // 1 hour for built profiles
const STALE_THRESHOLD = 60 * 60 * 1000; // 1 hour before re-fetching from API

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, expires: Date.now() + TTL });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? parseInt(sinceParam) : undefined;
  const profileCacheKey = `profile:${username.toLowerCase()}:${since || "all"}`;

  try {
    // Fast path: profile already built in memory
    const cachedProfile = getCached(profileCacheKey);
    if (cachedProfile) return NextResponse.json(cachedProfile);

    // Check DB cache for this player
    const platformId = username.toLowerCase();
    const cached = await getCachedOnlinePlayer("lichess", platformId);
    const isFresh = cached && (Date.now() - cached.lastFetchedAt.getTime()) < STALE_THRESHOLD;

    let user: LichessUser;
    let games: LichessGame[];

    if (isFresh && cached) {
      // Serve from DB cache — reconstruct LichessUser shape from cached data
      user = {
        id: cached.platformId,
        username: cached.username,
        perfs: {
          bullet: cached.bulletRating ? { rating: cached.bulletRating, games: 0, rd: 0, prog: 0 } : undefined,
          blitz: cached.blitzRating ? { rating: cached.blitzRating, games: 0, rd: 0, prog: 0 } : undefined,
          rapid: cached.rapidRating ? { rating: cached.rapidRating, games: 0, rd: 0, prog: 0 } : undefined,
          classical: cached.classicalRating ? { rating: cached.classicalRating, games: 0, rd: 0, prog: 0 } : undefined,
        },
      };

      // Load games from DB
      const dbGames = await getCachedOnlineGames(cached.id, 500);
      // Convert DB rows to LichessGame-like objects for fromLichessGame
      games = dbGames.map((g) => ({
        id: g.platformGameId,
        rated: true,
        variant: "standard",
        speed: g.speed || "rapid",
        perf: g.speed || "rapid",
        status: g.result === "draw" ? "draw" : "resign",
        players: {
          white: {
            user: g.playerColor === "white"
              ? { name: cached.username, id: cached.platformId }
              : { name: g.opponentName || "Opponent", id: (g.opponentName || "opponent").toLowerCase() },
            rating: g.playerColor === "white" ? (g.playerRating ?? undefined) : (g.opponentRating ?? undefined),
          },
          black: {
            user: g.playerColor === "black"
              ? { name: cached.username, id: cached.platformId }
              : { name: g.opponentName || "Opponent", id: (g.opponentName || "opponent").toLowerCase() },
            rating: g.playerColor === "black" ? (g.playerRating ?? undefined) : (g.opponentRating ?? undefined),
          },
        },
        winner: g.result === "win"
          ? g.playerColor as "white" | "black"
          : g.result === "loss"
            ? (g.playerColor === "white" ? "black" : "white") as "white" | "black"
            : undefined,
        opening: g.eco ? { eco: g.eco, name: g.opening || "", ply: 0 } : undefined,
        moves: g.moves || "",
        pgn: g.pgn || undefined,
        createdAt: g.playedAt?.getTime(),
      }));
    } else {
      // Fetch from Lichess API
      // If we have a cached record, fetch incrementally (only new games)
      const lastGameTime = cached ? await getLatestOnlineGameTime(cached.id) : null;
      const sinceFetch = lastGameTime ? lastGameTime.getTime() + 1 : undefined;

      const [fetchedUser, newGames] = await Promise.all([
        fetchLichessUser(username),
        fetchLichessGames(username, 500, sinceFetch),
      ]);

      user = fetchedUser;

      // Persist to DB (async, don't block response)
      const onlinePlayerId = await upsertCachedOnlinePlayer({
        platform: "lichess",
        platformId: platformId,
        username: fetchedUser.username,
        slug: `lichess-${platformId}`,
        bulletRating: fetchedUser.perfs?.bullet?.rating ?? null,
        blitzRating: fetchedUser.perfs?.blitz?.rating ?? null,
        rapidRating: fetchedUser.perfs?.rapid?.rating ?? null,
        classicalRating: fetchedUser.perfs?.classical?.rating ?? null,
      });

      if (onlinePlayerId && newGames.length > 0) {
        // Store new games in DB
        const gameRows = newGames.map((g) => {
          const isWhite = g.players.white?.user?.id?.toLowerCase() === platformId;
          return {
            platform: "lichess" as const,
            platformGameId: g.id,
            onlinePlayerId,
            playerColor: isWhite ? "white" : "black",
            opponentName: isWhite
              ? (g.players.black.user?.name ?? null)
              : (g.players.white.user?.name ?? null),
            opponentRating: isWhite
              ? (g.players.black.rating ?? null)
              : (g.players.white.rating ?? null),
            playerRating: isWhite
              ? (g.players.white.rating ?? null)
              : (g.players.black.rating ?? null),
            speed: g.speed || null,
            variant: g.variant || "standard",
            rated: g.rated,
            result: g.winner === (isWhite ? "white" : "black") ? "win"
              : g.winner === (isWhite ? "black" : "white") ? "loss"
                : g.status === "draw" || g.status === "stalemate" ? "draw"
                  : null,
            eco: g.opening?.eco ?? null,
            opening: g.opening?.name ?? null,
            playedAt: g.createdAt ? new Date(g.createdAt) : null,
            moves: g.moves || null,
            pgn: g.pgn ?? null,
            clockInitial: g.clock?.initial ?? null,
            clockIncrement: g.clock?.increment ?? null,
          };
        });
        insertOnlineGames(gameRows).catch(() => {}); // Fire and forget
      }

      // If incremental, merge with existing cached games
      if (sinceFetch && cached) {
        const existingGames = await getCachedOnlineGames(cached.id, 500 - newGames.length);
        // Combine: new API games + old DB games
        const oldGameObjects = existingGames.map((g) => ({
          id: g.platformGameId,
          rated: true,
          variant: "standard",
          speed: g.speed || "rapid",
          perf: g.speed || "rapid",
          status: g.result === "draw" ? "draw" : "resign",
          players: {
            white: {
              user: g.playerColor === "white"
                ? { name: cached.username, id: cached.platformId }
                : { name: g.opponentName || "Opponent", id: (g.opponentName || "opponent").toLowerCase() },
              rating: g.playerColor === "white" ? (g.playerRating ?? undefined) : (g.opponentRating ?? undefined),
            },
            black: {
              user: g.playerColor === "black"
                ? { name: cached.username, id: cached.platformId }
                : { name: g.opponentName || "Opponent", id: (g.opponentName || "opponent").toLowerCase() },
              rating: g.playerColor === "black" ? (g.playerRating ?? undefined) : (g.opponentRating ?? undefined),
            },
          },
          winner: g.result === "win"
            ? g.playerColor as "white" | "black"
            : g.result === "loss"
              ? (g.playerColor === "white" ? "black" : "white") as "white" | "black"
              : undefined,
          opening: g.eco ? { eco: g.eco, name: g.opening || "", ply: 0 } : undefined,
          moves: g.moves || "",
          pgn: g.pgn || undefined,
          createdAt: g.playedAt?.getTime(),
        } as LichessGame));
        games = [...newGames, ...oldGameObjects];
      } else {
        games = newGames;
      }
    }

    // Filter by time range if specified
    const filtered = since
      ? games.filter((g) => (g.createdAt ?? 0) >= since)
      : games;

    const normalized = filtered.map((g) => fromLichessGame(g, user.username));
    const profile = buildProfile(user, normalized);
    setCache(profileCacheKey, profile);

    return NextResponse.json(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Rate limited")) {
      return NextResponse.json({ error: message }, { status: 429 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

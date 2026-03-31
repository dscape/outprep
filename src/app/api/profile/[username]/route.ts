import { NextRequest, NextResponse } from "next/server";
import { fetchLichessUser, fetchLichessGames } from "@/lib/lichess";
import { fetchChesscomUser, fetchChesscomStats, fetchChesscomGames } from "@/lib/chesscom";
import { buildProfile, analyzeOpenings, extractRatings } from "@/lib/profile-builder";
import { estimateFIDE } from "@/lib/fide-estimator";
import { fromLichessGame, fromChesscomGame, normalizedToGameRecord } from "@/lib/normalized-game";
import type { LichessUser, LichessGame, ChesscomGame } from "@/lib/types";
import { getOnlineProfile, upsertOnlineProfile, upsertBotDataCache } from "@/lib/db";
import { buildOpeningTrie } from "@outprep/engine";

// Simple in-memory cache
const cache = new Map<string, { data: unknown; expires: number }>();
const TTL = 24 * 60 * 60 * 1000;

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, expires: Date.now() + TTL });
}

/** Helper: create an NDJSON streaming response with error handling */
function streamResponse(
  work: (emit: (chunk: Record<string, unknown>) => void) => Promise<void>,
) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (chunk: Record<string, unknown>) => {
        controller.enqueue(enc.encode(JSON.stringify(chunk) + "\n"));
      };
      try {
        await work(emit);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        emit({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

/** Build and persist bot data (opening tries + error profile + style metrics) from normalized games */
function persistBotData(
  platform: string,
  username: string,
  standardGames: { moves: string; playerColor: "white" | "black"; result?: "white" | "black" | "draw" }[],
  errorProfile: unknown,
  styleMetrics: unknown,
  gameCount: number,
  newestGameTs: number | null,
) {
  const gameRecords = standardGames.filter(g => g.moves);
  const whiteTrie = buildOpeningTrie(gameRecords, "white");
  const blackTrie = buildOpeningTrie(gameRecords, "black");
  // Fire and forget — cache write failure shouldn't block the response
  upsertBotDataCache(
    platform, username, whiteTrie, blackTrie,
    errorProfile, styleMetrics, gameCount, newestGameTs,
  ).catch(() => {});
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? parseInt(sinceParam) : undefined;
  const platform = request.nextUrl.searchParams.get("platform") || "lichess";
  const profileCacheKey = `profile:${platform}:${username.toLowerCase()}:${since || "all"}`;

  // Fast path: profile already built (in-memory)
  const cachedProfile = getCached(profileCacheKey);
  if (cachedProfile) return NextResponse.json(cachedProfile);

  if (platform === "chesscom") {
    return handleChesscom(username, since, profileCacheKey);
  }

  return handleLichess(username, since, profileCacheKey);
}

function handleLichess(
  username: string,
  since: number | undefined,
  profileCacheKey: string,
) {
  const userCacheKey = `user:lichess:${username.toLowerCase()}`;
  const gamesCacheKey = `games:lichess:${username.toLowerCase()}`;

  return streamResponse(async (emit) => {
    // DB cache check
    if (!since) {
      const dbProfile = await getOnlineProfile("lichess", username);
      if (dbProfile && dbProfile.profileJson) {
        const profile = dbProfile.profileJson;
        setCache(profileCacheKey, profile);
        emit({ type: "profile", profile });
        return;
      }
    }

    // Fetch user + games (the slow part — now inside the stream)
    let user = getCached(userCacheKey) as LichessUser | null;
    let games = getCached(gamesCacheKey) as LichessGame[] | null;

    if (!user || !games) {
      [user, games] = await Promise.all([
        fetchLichessUser(username),
        fetchLichessGames(username, 2000),
      ]);
      setCache(userCacheKey, user);
      setCache(gamesCacheKey, games);
    }

    const filtered = since
      ? games.filter((g) => (g.createdAt ?? 0) >= since)
      : games;

    const normalized = filtered.map((g) => fromLichessGame(g, user!.username));
    const standardGames = normalized.filter((g) => (g.variant ?? "standard") === "standard");

    // Line 1: fast computations — openings, ratings, fideEstimate
    const openings = analyzeOpenings(standardGames);
    const ratings = extractRatings(user!);
    const fideEst = estimateFIDE(user!);
    emit({
      type: "openings",
      openings,
      ratings,
      username: user!.username,
      gameCount: standardGames.length,
      fideEstimate: fideEst,
    });

    // Yield so the runtime flushes line 1 before the expensive computation
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Line 2: full profile (includes expensive analyzeStyle)
    const profile = buildProfile(user!, normalized);
    setCache(profileCacheKey, profile);
    emit({ type: "profile", profile });

    // Persist all-time profile + bot data to DB for fast repeat visits
    if (!since) {
      const newestTs = games.length > 0
        ? Math.max(...games.map((g) => g.createdAt ?? 0))
        : null;
      upsertOnlineProfile("lichess", username, profile, games.length, newestTs).catch(() => {});

      // Build and cache bot data (opening tries + error profile + style metrics)
      const gameRecords = standardGames.map(normalizedToGameRecord);
      persistBotData(
        "lichess", username, gameRecords,
        profile.errorProfile, profile.style,
        standardGames.length, newestTs,
      );
    }
  });
}

function handleChesscom(
  username: string,
  since: number | undefined,
  profileCacheKey: string,
) {
  const userCacheKey = `user:chesscom:${username.toLowerCase()}`;
  const gamesCacheKey = `games:chesscom:${username.toLowerCase()}:${since || "all"}`;

  return streamResponse(async (emit) => {
    // DB cache check
    if (!since) {
      const dbProfile = await getOnlineProfile("chesscom", username);
      if (dbProfile && dbProfile.profileJson) {
        const profile = dbProfile.profileJson;
        setCache(profileCacheKey, profile);
        emit({ type: "profile", profile });
        return;
      }
    }

    // Fetch user + stats + games (the slow part — now inside the stream)
    let userLike = getCached(userCacheKey) as LichessUser | null;
    let games = getCached(gamesCacheKey) as ChesscomGame[] | null;

    if (!userLike || !games) {
      const [ccUser, ccStats, ccGames] = await Promise.all([
        fetchChesscomUser(username),
        fetchChesscomStats(username),
        fetchChesscomGames(username, 2000, since),
      ]);

      // Convert Chess.com user/stats to LichessUser-compatible shape for buildProfile
      userLike = {
        id: ccUser.username.toLowerCase(),
        username: ccUser.username,
        perfs: {
          bullet: ccStats.chess_bullet ? { rating: ccStats.chess_bullet.last.rating, games: (ccStats.chess_bullet.record?.win ?? 0) + (ccStats.chess_bullet.record?.loss ?? 0) + (ccStats.chess_bullet.record?.draw ?? 0), rd: 0, prog: 0 } : undefined,
          blitz: ccStats.chess_blitz ? { rating: ccStats.chess_blitz.last.rating, games: (ccStats.chess_blitz.record?.win ?? 0) + (ccStats.chess_blitz.record?.loss ?? 0) + (ccStats.chess_blitz.record?.draw ?? 0), rd: 0, prog: 0 } : undefined,
          rapid: ccStats.chess_rapid ? { rating: ccStats.chess_rapid.last.rating, games: (ccStats.chess_rapid.record?.win ?? 0) + (ccStats.chess_rapid.record?.loss ?? 0) + (ccStats.chess_rapid.record?.draw ?? 0), rd: 0, prog: 0 } : undefined,
          classical: ccStats.chess_daily ? { rating: ccStats.chess_daily.last.rating, games: (ccStats.chess_daily.record?.win ?? 0) + (ccStats.chess_daily.record?.loss ?? 0) + (ccStats.chess_daily.record?.draw ?? 0), rd: 0, prog: 0 } : undefined,
        },
        count: { all: ccGames.length, rated: ccGames.length },
      };
      games = ccGames;

      setCache(userCacheKey, userLike);
      setCache(gamesCacheKey, games);
    }

    const filtered = since
      ? games.filter((g) => g.end_time * 1000 >= since)
      : games;

    const normalized = filtered.map((g) => fromChesscomGame(g, userLike!.username));
    const standardGames = normalized.filter((g) => (g.variant ?? "standard") === "standard");

    // Line 1: fast computations
    const openings = analyzeOpenings(standardGames);
    const ratings = extractRatings(userLike!);
    const fideEst = estimateFIDE(userLike!);
    emit({
      type: "openings",
      openings,
      ratings,
      username: userLike!.username,
      gameCount: standardGames.length,
      fideEstimate: fideEst,
    });

    // Yield so the runtime flushes line 1 before the expensive computation
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Line 2: full profile (includes expensive analyzeStyle)
    const profile = buildProfile(userLike!, normalized);
    setCache(profileCacheKey, profile);
    emit({ type: "profile", profile });

    // Persist all-time profile + bot data to DB
    if (!since) {
      const newestTs = games.length > 0
        ? Math.max(...games.map((g) => g.end_time * 1000))
        : null;
      upsertOnlineProfile("chesscom", username, profile, games.length, newestTs).catch(() => {});

      // Build and cache bot data
      const gameRecords = standardGames.map(normalizedToGameRecord);
      persistBotData(
        "chesscom", username, gameRecords,
        profile.errorProfile, profile.style,
        standardGames.length, newestTs,
      );
    }
  });
}

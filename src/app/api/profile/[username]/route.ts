import { NextRequest, NextResponse } from "next/server";
import { fetchLichessUser, fetchLichessGames } from "@/lib/lichess";
import { fetchChesscomUser, fetchChesscomStats, fetchChesscomGames } from "@/lib/chesscom";
import { buildProfile, analyzeOpenings, extractRatings } from "@/lib/profile-builder";
import { estimateFIDE } from "@/lib/fide-estimator";
import { fromLichessGame, fromChesscomGame } from "@/lib/normalized-game";
import type { LichessUser, LichessGame, ChesscomGame } from "@/lib/types";
import { getOnlineProfile, upsertOnlineProfile } from "@/lib/db";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? parseInt(sinceParam) : undefined;
  const platform = request.nextUrl.searchParams.get("platform") || "lichess";
  const profileCacheKey = `profile:${platform}:${username.toLowerCase()}:${since || "all"}`;

  try {
    // Fast path: profile already built for this time range
    const cachedProfile = getCached(profileCacheKey);
    if (cachedProfile) return NextResponse.json(cachedProfile);

    if (platform === "chesscom") {
      return await handleChesscom(username, since, profileCacheKey);
    }

    return await handleLichess(username, since, profileCacheKey);
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

async function handleLichess(
  username: string,
  since: number | undefined,
  profileCacheKey: string,
) {
  const userCacheKey = `user:lichess:${username.toLowerCase()}`;
  const gamesCacheKey = `games:lichess:${username.toLowerCase()}`;

  // For all-time requests, try DB cache first
  if (!since) {
    const dbProfile = await getOnlineProfile("lichess", username);
    if (dbProfile && dbProfile.profileJson) {
      const profile = dbProfile.profileJson;
      setCache(profileCacheKey, profile);
      return NextResponse.json(profile);
    }
  }

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

  // Stream NDJSON: openings first (fast), full profile second (slow)
  const capturedUser = user!;
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      // Line 1: fast computations — openings, ratings, fideEstimate
      const openings = analyzeOpenings(standardGames);
      const ratings = extractRatings(capturedUser);
      const fideEst = estimateFIDE(capturedUser);
      controller.enqueue(enc.encode(JSON.stringify({
        type: "openings",
        openings,
        ratings,
        username: capturedUser.username,
        gameCount: standardGames.length,
        fideEstimate: fideEst,
      }) + "\n"));

      // Line 2: full profile (includes expensive analyzeStyle)
      const profile = buildProfile(capturedUser, normalized);
      setCache(profileCacheKey, profile);
      controller.enqueue(enc.encode(JSON.stringify({ type: "profile", profile }) + "\n"));
      controller.close();

      // Persist all-time profile to DB for fast repeat visits
      if (!since) {
        const newestTs = games!.length > 0
          ? Math.max(...games!.map((g) => g.createdAt ?? 0))
          : null;
        upsertOnlineProfile("lichess", username, profile, games!.length, newestTs).catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

async function handleChesscom(
  username: string,
  since: number | undefined,
  profileCacheKey: string,
) {
  const userCacheKey = `user:chesscom:${username.toLowerCase()}`;
  const gamesCacheKey = `games:chesscom:${username.toLowerCase()}:${since || "all"}`;

  // For all-time requests, try DB cache first
  if (!since) {
    const dbProfile = await getOnlineProfile("chesscom", username);
    if (dbProfile && dbProfile.profileJson) {
      const profile = dbProfile.profileJson;
      setCache(profileCacheKey, profile);
      return NextResponse.json(profile);
    }
  }

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

  // Stream NDJSON: openings first (fast), full profile second (slow)
  const capturedUser = userLike!;
  const capturedGames = games;
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      // Line 1: fast computations
      const openings = analyzeOpenings(standardGames);
      const ratings = extractRatings(capturedUser);
      const fideEst = estimateFIDE(capturedUser);
      controller.enqueue(enc.encode(JSON.stringify({
        type: "openings",
        openings,
        ratings,
        username: capturedUser.username,
        gameCount: standardGames.length,
        fideEstimate: fideEst,
      }) + "\n"));

      // Line 2: full profile (includes expensive analyzeStyle)
      const profile = buildProfile(capturedUser, normalized);
      setCache(profileCacheKey, profile);
      controller.enqueue(enc.encode(JSON.stringify({ type: "profile", profile }) + "\n"));
      controller.close();

      // Persist all-time profile to DB
      if (!since) {
        const newestTs = capturedGames!.length > 0
          ? Math.max(...capturedGames!.map((g) => g.end_time * 1000))
          : null;
        upsertOnlineProfile("chesscom", username, profile, capturedGames!.length, newestTs).catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

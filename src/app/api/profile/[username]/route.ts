import { NextRequest, NextResponse } from "next/server";
import { fetchLichessUser, fetchLichessGames } from "@/lib/lichess";
import { fetchChesscomUser, fetchChesscomStats, fetchChesscomGames } from "@/lib/chesscom";
import { buildProfile } from "@/lib/profile-builder";
import { fromLichessGame, fromChesscomGame } from "@/lib/normalized-game";
import type { LichessUser, LichessGame, ChesscomGame } from "@/lib/types";

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
  const profile = buildProfile(user!, normalized);
  setCache(profileCacheKey, profile);

  return NextResponse.json(profile);
}

async function handleChesscom(
  username: string,
  since: number | undefined,
  profileCacheKey: string,
) {
  const userCacheKey = `user:chesscom:${username.toLowerCase()}`;
  const gamesCacheKey = `games:chesscom:${username.toLowerCase()}:${since || "all"}`;

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
  const profile = buildProfile(userLike!, normalized);
  setCache(profileCacheKey, profile);

  return NextResponse.json(profile);
}

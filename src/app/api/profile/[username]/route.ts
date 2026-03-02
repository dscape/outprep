import { NextRequest, NextResponse } from "next/server";
import { fetchLichessUser, fetchLichessGames } from "@/lib/lichess";
import { buildProfile } from "@/lib/profile-builder";
import { fromLichessGame } from "@/lib/normalized-game";
import type { LichessUser, LichessGame } from "@/lib/types";

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
  const profileCacheKey = `profile:${username.toLowerCase()}:${since || "all"}`;

  try {
    // Fast path: profile already built for this time range
    const cachedProfile = getCached(profileCacheKey);
    if (cachedProfile) return NextResponse.json(cachedProfile);

    // Get raw data from cache or Lichess (cached by username only)
    const userCacheKey = `user:${username.toLowerCase()}`;
    const gamesCacheKey = `games:${username.toLowerCase()}`;

    let user = getCached(userCacheKey) as LichessUser | null;
    let games = getCached(gamesCacheKey) as LichessGame[] | null;

    if (!user || !games) {
      [user, games] = await Promise.all([
        fetchLichessUser(username),
        fetchLichessGames(username, 500),
      ]);
      setCache(userCacheKey, user);
      setCache(gamesCacheKey, games);
    }

    // Filter by time range if specified
    const filtered = since
      ? games.filter((g) => (g.createdAt ?? 0) >= since)
      : games;

    const normalized = filtered.map((g) => fromLichessGame(g, user!.username));
    const profile = buildProfile(user!, normalized);
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

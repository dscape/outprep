import { NextRequest, NextResponse } from "next/server";
import { fetchLichessUser, fetchLichessGames } from "@/lib/lichess";
import { buildProfile } from "@/lib/profile-builder";

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
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const cacheKey = `profile:${username.toLowerCase()}`;

  try {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json(cached);

    const [user, games] = await Promise.all([
      fetchLichessUser(username),
      fetchLichessGames(username, 500),
    ]);

    const profile = buildProfile(user, games);
    setCache(cacheKey, profile);

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

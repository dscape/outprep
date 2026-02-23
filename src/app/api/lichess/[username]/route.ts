import { NextRequest, NextResponse } from "next/server";
import { fetchLichessUser, fetchLichessGames } from "@/lib/lichess";

// Simple in-memory cache for development (Vercel KV in production)
const cache = new Map<string, { data: unknown; expires: number }>();
const TTL = 24 * 60 * 60 * 1000; // 24 hours

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
  const type = request.nextUrl.searchParams.get("type") || "user";

  try {
    if (type === "user") {
      const cacheKey = `lichess:user:${username.toLowerCase()}`;
      const cached = getCached(cacheKey);
      if (cached) return NextResponse.json(cached);

      const user = await fetchLichessUser(username);
      setCache(cacheKey, user);
      return NextResponse.json(user);
    }

    if (type === "games") {
      const max = parseInt(request.nextUrl.searchParams.get("max") || "200");
      const cacheKey = `lichess:games:${username.toLowerCase()}:${max}`;
      const cached = getCached(cacheKey);
      if (cached) return NextResponse.json(cached);

      const games = await fetchLichessGames(username, max);
      setCache(cacheKey, games);
      return NextResponse.json(games);
    }

    return NextResponse.json({ error: "Invalid type parameter" }, { status: 400 });
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

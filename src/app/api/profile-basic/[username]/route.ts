import { NextRequest, NextResponse } from "next/server";
import { fetchLichessUser } from "@/lib/lichess";

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
  const cacheKey = `basic:${username.toLowerCase()}`;

  try {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json(cached);

    const user = await fetchLichessUser(username);

    const basicProfile = {
      username: user.username,
      ratings: {
        bullet: user.perfs?.bullet?.prov ? undefined : user.perfs?.bullet?.rating,
        blitz: user.perfs?.blitz?.prov ? undefined : user.perfs?.blitz?.rating,
        rapid: user.perfs?.rapid?.prov ? undefined : user.perfs?.rapid?.rating,
        classical: user.perfs?.classical?.prov ? undefined : user.perfs?.classical?.rating,
      },
      totalGames: user.count?.rated ?? user.count?.all ?? 0,
    };

    setCache(cacheKey, basicProfile);
    return NextResponse.json(basicProfile);
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

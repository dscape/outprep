import { NextRequest, NextResponse } from "next/server";

const cache = new Map<string, { data: unknown; expires: number }>();
const TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, expires: Date.now() + TTL });
}

export async function GET(request: NextRequest) {
  const term = request.nextUrl.searchParams.get("term");
  if (!term || term.trim().length < 2) {
    return NextResponse.json([]);
  }

  const trimmed = term.trim();
  const cacheKey = `lichess:autocomplete:${trimmed.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const res = await fetch(
      `https://lichess.org/api/player/autocomplete?term=${encodeURIComponent(trimmed)}&nb=5&object=true`,
      { headers: { Accept: "application/json" } },
    );

    if (!res.ok) {
      return NextResponse.json([]);
    }

    const data = await res.json();
    const results = (data.result || []).map(
      (p: Record<string, unknown>) => ({
        id: p.id,
        name: p.name,
        title: p.title || undefined,
        online: p.online || false,
        patron: p.patron || false,
      }),
    );

    setCache(cacheKey, results);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json([]);
  }
}

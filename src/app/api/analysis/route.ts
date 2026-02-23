import { NextRequest, NextResponse } from "next/server";

// In-memory cache for profile lookups during analysis
const profileCache = new Map<string, { data: unknown; expires: number }>();
const TTL = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username");

  if (!username) {
    return NextResponse.json({ error: "username parameter is required" }, { status: 400 });
  }

  try {
    const cacheKey = `profile:${username.toLowerCase()}`;
    const cached = profileCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return NextResponse.json(cached.data);
    }

    // Fetch profile from our own API
    const baseUrl = request.nextUrl.origin;
    const res = await fetch(`${baseUrl}/api/profile/${encodeURIComponent(username)}`);

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json(err, { status: res.status });
    }

    const profile = await res.json();
    profileCache.set(cacheKey, { data: profile, expires: Date.now() + TTL });

    return NextResponse.json(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

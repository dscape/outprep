import { NextRequest, NextResponse } from "next/server";
import {
  getPlayerByFideId,
  upsertOnlinePlayer,
  suggestLink,
} from "@/lib/db";

/**
 * POST /api/suggest-link
 *
 * Suggest a link between a FIDE player and an online account.
 * Body: { fideId: string, platform: "lichess" | "chesscom", username: string }
 *
 * Rate-limited by IP (simple in-memory tracker).
 */

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10; // max suggestions per window
const RATE_WINDOW = 3600_000; // 1 hour

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many suggestions. Try again later." },
      { status: 429 },
    );
  }

  let body: { fideId?: string; platform?: string; username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { fideId, platform, username } = body;

  if (!fideId || !platform || !username) {
    return NextResponse.json(
      { error: "Missing required fields: fideId, platform, username" },
      { status: 400 },
    );
  }

  if (!["lichess", "chesscom"].includes(platform)) {
    return NextResponse.json(
      { error: "Platform must be 'lichess' or 'chesscom'" },
      { status: 400 },
    );
  }

  // Validate FIDE player exists
  const player = await getPlayerByFideId(fideId);
  if (!player) {
    return NextResponse.json(
      { error: "FIDE player not found" },
      { status: 404 },
    );
  }

  // Validate online account exists by calling the platform API
  const platformId = username.toLowerCase();
  let displayName = username;

  if (platform === "lichess") {
    try {
      const res = await fetch(`https://lichess.org/api/user/${platformId}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: "Lichess username not found" },
          { status: 404 },
        );
      }
      const data = await res.json();
      displayName = data.username ?? username;
    } catch {
      return NextResponse.json(
        { error: "Failed to verify Lichess username" },
        { status: 502 },
      );
    }
  } else if (platform === "chesscom") {
    try {
      const res = await fetch(
        `https://api.chess.com/pub/player/${platformId}`,
      );
      if (!res.ok) {
        return NextResponse.json(
          { error: "Chess.com username not found" },
          { status: 404 },
        );
      }
      const data = await res.json();
      displayName = data.username ?? username;
    } catch {
      return NextResponse.json(
        { error: "Failed to verify Chess.com username" },
        { status: 502 },
      );
    }
  }

  // Upsert online player record
  const onlinePlayerId = await upsertOnlinePlayer({
    platform,
    platformId,
    username: displayName,
    slug: `${platform}-${platformId}`,
  });

  if (!onlinePlayerId) {
    return NextResponse.json(
      { error: "Failed to create online player record" },
      { status: 500 },
    );
  }

  // Create the suggestion
  const link = await suggestLink({
    fideId,
    platform,
    platformId,
    suggestedBy: ip,
  });

  if (!link) {
    return NextResponse.json(
      { error: "Link already exists or failed to create" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    id: link.id,
    status: link.status,
    message: `Suggestion submitted. ${displayName} (${platform}) → ${player.name} (FIDE ${fideId})`,
  });
}

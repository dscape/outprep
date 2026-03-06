import { NextRequest, after } from "next/server";
import { parseAllPGNGames } from "@/lib/pgn-parser";
import { analyzeOTBGames } from "@/lib/otb-analyzer";
import {
  getPlayerByFideId,
  getPlayerGamePgns,
  formatPlayerName,
  getFideProfile,
  getLatestFideProfile,
  upsertFideProfile,
} from "@/lib/db";
import type { PlayerRatings } from "@/lib/types";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400, s-maxage=604800",
};

/** Current month in YYYY-MM format (UTC). */
function currentMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Build an OTBProfile server-side for FIDE players.
 * Uses a monthly DB cache to avoid expensive PGN parsing on every request.
 *
 * Flow:
 *  1. Current month cache hit → return immediately
 *  2. Any month cache hit → return stale + recompute in background
 *  3. No cache → compute synchronously, cache, return
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const month = currentMonth();

  // ─── 1. Check current month's cached profile ─────────────────────
  const cached = await getFideProfile(slug, month);
  if (cached?.profileJson) {
    return Response.json(cached.profileJson, { headers: CACHE_HEADERS });
  }

  // ─── 2. Fall back to most recent cached profile ──────────────────
  const stale = await getLatestFideProfile(slug);
  if (stale?.profileJson) {
    // Return stale data immediately, recompute current month in background
    after(async () => {
      await computeAndCache(slug, month, req);
    });
    return Response.json(stale.profileJson, { headers: CACHE_HEADERS });
  }

  // ─── 3. No cache — compute synchronously ─────────────────────────
  const result = await computeAndCache(slug, month, req);
  if (result.error) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result.profile, { headers: CACHE_HEADERS });
}

async function computeAndCache(
  slug: string,
  month: string,
  req: NextRequest,
): Promise<{ profile?: unknown; error?: string; status?: number }> {
  const fideIdMatch = slug.match(/-(\d{4,})$/);
  const fideId = fideIdMatch ? fideIdMatch[1] : null;

  let displayName: string | null = null;
  let fideRatings: PlayerRatings | undefined;
  if (fideId) {
    const player = await getPlayerByFideId(fideId);
    if (player) {
      displayName = formatPlayerName(player.name);
      const ratings: PlayerRatings = {};
      if (player.standardRating) ratings.classical = player.standardRating;
      if (player.rapidRating) ratings.rapid = player.rapidRating;
      if (player.blitzRating) ratings.blitz = player.blitzRating;
      if (Object.keys(ratings).length > 0) fideRatings = ratings;
    }
  }

  const nameParam = req.nextUrl.searchParams.get("name");
  const playerName =
    displayName || nameParam || slug.replace(/-\d{4,}$/, "").replace(/-/g, " ");
  const rawPgns = await getPlayerGamePgns(slug);

  if (!rawPgns || rawPgns.length === 0) {
    return { error: "No games found for this player", status: 404 };
  }

  const combinedPgn = rawPgns.join("\n\n");
  const otbGames = parseAllPGNGames(combinedPgn);

  if (otbGames.length === 0) {
    return { error: "Could not parse any games", status: 422 };
  }

  const profile = analyzeOTBGames(otbGames, playerName);

  if (displayName) profile.username = displayName;
  if (fideRatings) profile.ratings = fideRatings;

  // Strip raw PGN text from each game to keep the payload small.
  const compactGames = (profile.games || []).map((g) => ({
    white: g.white,
    black: g.black,
    result: g.result,
    date: g.date,
    event: g.event,
    eco: g.eco,
    opening: g.opening,
    timeControl: g.timeControl,
    moves: g.moves,
    pgn: "",
  }));

  const compactProfile = { ...profile, games: compactGames };

  // Persist to DB cache
  await upsertFideProfile(slug, month, compactProfile, otbGames.length);

  return { profile: compactProfile };
}

import { NextRequest } from "next/server";
import { parseAllPGNGames } from "@/lib/pgn-parser";
import { analyzeOTBGames } from "@/lib/otb-analyzer";
import { getPlayerByFideId, getPlayerGamePgns, formatPlayerName } from "@/lib/db";
import type { PlayerRatings } from "@/lib/types";

/**
 * Build an OTBProfile server-side for FIDE players.
 * Returns a compact profile (games have pgn stripped) to avoid
 * exceeding the client's sessionStorage quota.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Extract FIDE ID from slug (trailing digits after last hyphen)
  const fideIdMatch = slug.match(/-(\d{4,})$/);
  const fideId = fideIdMatch ? fideIdMatch[1] : null;

  // Look up canonical player name and ratings from DB using FIDE ID
  let displayName: string | null = null;
  let fideRatings: PlayerRatings | undefined;
  if (fideId) {
    const player = await getPlayerByFideId(fideId);
    if (player) {
      displayName = formatPlayerName(player.name);
      // Populate ratings from official FIDE data
      const ratings: PlayerRatings = {};
      if (player.standardRating) ratings.classical = player.standardRating;
      if (player.rapidRating) ratings.rapid = player.rapidRating;
      if (player.blitzRating) ratings.blitz = player.blitzRating;
      if (Object.keys(ratings).length > 0) fideRatings = ratings;
    }
  }

  // Fallback: use ?name= param or derive from slug
  const nameParam = req.nextUrl.searchParams.get("name");
  const playerName = displayName || nameParam || slug.replace(/-\d{4,}$/, "").replace(/-/g, " ");
  const rawPgns = await getPlayerGamePgns(slug);

  if (!rawPgns || rawPgns.length === 0) {
    return Response.json({ error: "No games found for this player" }, { status: 404 });
  }

  const combinedPgn = rawPgns.join("\n\n");
  const otbGames = parseAllPGNGames(combinedPgn);

  if (otbGames.length === 0) {
    return Response.json({ error: "Could not parse any games" }, { status: 422 });
  }

  const profile = analyzeOTBGames(otbGames, playerName);

  // Override username with clean display name from DB (avoids PGN-format names)
  if (displayName) {
    profile.username = displayName;
  }

  // Attach FIDE ratings if available
  if (fideRatings) {
    profile.ratings = fideRatings;
  }

  // Strip raw PGN text from each game to keep the payload small.
  // The moves, headers, and metadata are still available for display.
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
    pgn: "", // Stripped — fetch individual PGN on-demand if needed
  }));

  return Response.json(
    { ...profile, games: compactGames },
    {
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    }
  );
}

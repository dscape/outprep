import { NextRequest } from "next/server";
import { getPlayerGames } from "@/lib/fide-blob";
import { parseAllPGNGames } from "@/lib/pgn-parser";
import { analyzeOTBGames } from "@/lib/otb-analyzer";

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
  const playerName = req.nextUrl.searchParams.get("name") || slug;
  const rawPgns = await getPlayerGames(slug);

  if (!rawPgns || rawPgns.length === 0) {
    return Response.json({ error: "No games found for this player" }, { status: 404 });
  }

  const combinedPgn = rawPgns.join("\n\n");
  const otbGames = parseAllPGNGames(combinedPgn);

  if (otbGames.length === 0) {
    return Response.json({ error: "Could not parse any games" }, { status: 422 });
  }

  const profile = analyzeOTBGames(otbGames, playerName);

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

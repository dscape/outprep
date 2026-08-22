import { NextRequest } from "next/server";
import { getPlayerGamePgns } from "@/lib/db";
import { isExcludedFideSlug } from "@/lib/player-exclusions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (isExcludedFideSlug(slug)) {
    return Response.json({ error: "Player not found" }, { status: 404 });
  }

  const games = await getPlayerGamePgns(slug);

  if (!games) {
    return Response.json({ error: "Player not found" }, { status: 404 });
  }

  return Response.json(
    { games },
    {
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    }
  );
}

import { NextRequest } from "next/server";
import { getPlayerGames } from "@/lib/practice-blob";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const games = await getPlayerGames(slug);

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

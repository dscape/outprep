import { NextRequest, NextResponse } from "next/server";
import { getGameEvals, storeGameEvals } from "@/lib/db";

/**
 * GET /api/game-evals?platform=fide&username=slug&gameIds=id1,id2,...
 * Returns stored Stockfish evaluations for the given game IDs.
 */
export async function GET(request: NextRequest) {
  const platform = request.nextUrl.searchParams.get("platform") || "";
  const username = request.nextUrl.searchParams.get("username") || "";
  const gameIdsParam = request.nextUrl.searchParams.get("gameIds") || "";

  if (!platform || !username || !gameIdsParam) {
    return NextResponse.json({ error: "Missing required params" }, { status: 400 });
  }

  const gameIds = gameIdsParam.split(",").filter(Boolean);
  if (gameIds.length === 0) {
    return NextResponse.json({ evals: {} });
  }

  try {
    const evalsMap = await getGameEvals(platform, username, gameIds);
    const evals: Record<string, unknown> = {};
    for (const [id, data] of evalsMap) {
      evals[id] = data;
    }
    return NextResponse.json({ evals });
  } catch {
    // Table may not exist yet — return empty
    return NextResponse.json({ evals: {} });
  }
}

/**
 * POST /api/game-evals
 * Store Stockfish evaluations for games.
 * Body: { platform, username, evals: [{ gameId, evalData, evalMode }] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { platform, username, evals } = body;

    if (!platform || !username || !Array.isArray(evals) || evals.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await storeGameEvals(platform, username, evals);
    return NextResponse.json({ stored: evals.length });
  } catch {
    return NextResponse.json({ error: "Failed to store evals" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { fetchLichessGames } from "@/lib/lichess";
import type { OpeningTrie, ErrorProfile } from "@outprep/engine";
import { buildOpeningTrie, buildErrorProfileFromEvals } from "@outprep/engine";
import { fromLichessGame, normalizedToGameRecord, normalizedToGameEvalData } from "@/lib/normalized-game";

/**
 * Returns the bot data needed to play against an opponent:
 * - Error profile (per-phase mistake rates from Lichess evals)
 * - Opening tries (one per color, JSON move trie)
 */

interface BotData {
  errorProfile: ErrorProfile;
  whiteTrie: OpeningTrie;
  blackTrie: OpeningTrie;
  gameMoves: Array<{ moves: string; playerColor: "white" | "black"; hasEvals: boolean }>;
}

const cache = new Map<string, { data: BotData; expires: number }>();
const TTL = 24 * 60 * 60 * 1000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const speedsParam = request.nextUrl.searchParams.get("speeds");
  const speeds = speedsParam ? speedsParam.split(",").filter(Boolean) : [];
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? parseInt(sinceParam) : undefined;
  const cacheKey = `bot:${username.toLowerCase()}:${speeds.length > 0 ? speeds.sort().join(",") : "all"}:${since || "all"}`;

  try {
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return NextResponse.json(cached.data);
    }

    const rawGames = await fetchLichessGames(username, 500);
    let filtered = rawGames.filter((g) => g.variant === "standard");
    if (speeds.length > 0) {
      filtered = filtered.filter((g) => speeds.includes(g.speed));
    }
    if (since) {
      filtered = filtered.filter((g) => (g.createdAt ?? 0) >= since);
    }

    const normalized = filtered.map((g) => fromLichessGame(g, username));
    const evalData = normalized
      .map(normalizedToGameEvalData)
      .filter((d): d is NonNullable<typeof d> => d !== null);
    const errorProfile = buildErrorProfileFromEvals(evalData);
    const gameRecords = normalized.map(normalizedToGameRecord);
    const whiteTrie = buildOpeningTrie(gameRecords, "white");
    const blackTrie = buildOpeningTrie(gameRecords, "black");

    // Extract game moves for client-side batch eval
    // playerColor = the profiled player's color (the opponent we're mimicking)
    const gameMoves = normalized
      .filter((g) => g.moves)
      .map((g) => ({
        moves: g.moves,
        playerColor: g.playerColor,
        hasEvals: !!g.evals && g.evals.length > 0,
      }));

    const data: BotData = { errorProfile, whiteTrie, blackTrie, gameMoves };
    cache.set(cacheKey, { data, expires: Date.now() + TTL });

    return NextResponse.json(data);
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

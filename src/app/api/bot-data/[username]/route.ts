import { NextRequest, NextResponse } from "next/server";
import { fetchLichessGames } from "@/lib/lichess";
import { fetchChesscomGames } from "@/lib/chesscom";
import type { OpeningTrie, ErrorProfile, GameRecord, StyleMetrics } from "@outprep/engine";
import { buildOpeningTrie, buildErrorProfileFromEvals, analyzeStyleFromRecords } from "@outprep/engine";
import { fromLichessGame, fromChesscomGame, normalizedToGameRecord, normalizedToGameEvalData } from "@/lib/normalized-game";
import type { NormalizedGame } from "@/lib/normalized-game";
import { getPlayer, getPlayerGamePgns, formatPlayerName, getBotDataCache, upsertBotDataCache } from "@/lib/db";
import { parseAllPGNGames } from "@/lib/pgn-parser";
import { matchesPlayerName, crc32 } from "@outprep/engine";

/**
 * Returns the bot data needed to play against an opponent:
 * - Error profile (per-phase mistake rates from evals)
 * - Opening tries (one per color, JSON move trie)
 * - Style metrics (for bot personality)
 */

interface BotDataResponse {
  errorProfile: ErrorProfile;
  whiteTrie: OpeningTrie;
  blackTrie: OpeningTrie;
  styleMetrics: StyleMetrics;
  // gameMoves included when computed from scratch (used by stockfish upgrade on scout page)
  // Omitted when served from DB cache (play page doesn't need them)
  gameMoves?: Array<{ id: string; moves: string; playerColor: "white" | "black"; result: "white" | "black" | "draw"; hasEvals: boolean }>;
}

// L1: in-memory cache (survives within a single serverless invocation)
const cache = new Map<string, { data: BotDataResponse; expires: number }>();
const TTL = 24 * 60 * 60 * 1000;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const speedsParam = request.nextUrl.searchParams.get("speeds");
  const speeds = speedsParam ? speedsParam.split(",").filter(Boolean) : [];
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? parseInt(sinceParam) : undefined;
  const platform = request.nextUrl.searchParams.get("platform") || "lichess";

  // For filtered requests (speed or time range), fall through to computation
  // DB cache stores all-time, all-speeds data
  const isFiltered = speeds.length > 0 || !!since;
  const memoryCacheKey = `bot:${platform}:${username.toLowerCase()}:${speeds.length > 0 ? speeds.sort().join(",") : "all"}:${since || "all"}`;

  try {
    // L1: in-memory cache check
    const memoryCached = cache.get(memoryCacheKey);
    if (memoryCached && memoryCached.expires > Date.now()) {
      return NextResponse.json(memoryCached.data, { headers: CACHE_HEADERS });
    }

    // FIDE path: always compute from DB (no Lichess dependency)
    if (platform === "fide") {
      const data = await buildFideBotData(username, since);
      if (!data) {
        return NextResponse.json({ error: "No games found" }, { status: 404 });
      }
      cache.set(memoryCacheKey, { data, expires: Date.now() + TTL });
      return NextResponse.json(data, { headers: CACHE_HEADERS });
    }

    // L2: DB cache check (all-time, all-speeds only)
    if (!isFiltered) {
      const dbCached = await getBotDataCache(platform, username);
      if (dbCached && dbCached.whiteTrie && dbCached.blackTrie) {
        const data: BotDataResponse = {
          whiteTrie: dbCached.whiteTrie as OpeningTrie,
          blackTrie: dbCached.blackTrie as OpeningTrie,
          errorProfile: dbCached.errorProfile as ErrorProfile,
          styleMetrics: dbCached.styleMetrics as StyleMetrics,
        };
        cache.set(memoryCacheKey, { data, expires: Date.now() + TTL });
        return NextResponse.json(data, { headers: CACHE_HEADERS });
      }
    }

    // Cache miss: build bot data from scratch (same pipeline as profile API)
    const data = await buildOnlineBotData(platform, username, speeds, since);
    cache.set(memoryCacheKey, { data, expires: Date.now() + TTL });
    return NextResponse.json(data, { headers: CACHE_HEADERS });
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

/**
 * Build bot data for Lichess/Chess.com players.
 * Also persists to DB for future cache hits.
 */
async function buildOnlineBotData(
  platform: string,
  username: string,
  speeds: string[],
  since: number | undefined,
): Promise<BotDataResponse> {
  let normalized: NormalizedGame[];

  if (platform === "chesscom") {
    const rawGames = await fetchChesscomGames(username, 2000, since);
    normalized = rawGames.map((g) => fromChesscomGame(g, username));
    if (speeds.length > 0) {
      normalized = normalized.filter((g) => g.speed && speeds.includes(g.speed));
    }
  } else {
    const rawGames = await fetchLichessGames(username, 2000);
    let filtered = rawGames.filter((g) => g.variant === "standard");
    if (speeds.length > 0) {
      filtered = filtered.filter((g) => speeds.includes(g.speed));
    }
    if (since) {
      filtered = filtered.filter((g) => (g.createdAt ?? 0) >= since);
    }
    normalized = filtered.map((g) => fromLichessGame(g, username));
  }

  const evalData = normalized
    .map(normalizedToGameEvalData)
    .filter((d): d is NonNullable<typeof d> => d !== null);
  const errorProfile = buildErrorProfileFromEvals(evalData);
  const gameRecords = normalized.map(normalizedToGameRecord);
  const whiteTrie = buildOpeningTrie(gameRecords, "white");
  const blackTrie = buildOpeningTrie(gameRecords, "black");
  const styleMetrics = analyzeStyleFromRecords(gameRecords);

  // Build gameMoves for stockfish upgrade (scout page uses these)
  const platformPrefix = platform === "chesscom" ? "CHESSCOM" : "LICHESS";
  const gameMoves = normalized
    .filter((g) => g.moves)
    .map((g) => ({
      id: `${platformPrefix}:${username}:${g.id}`,
      moves: g.moves,
      playerColor: g.playerColor,
      result: g.result || "draw" as const,
      hasEvals: !!g.evals && g.evals.length > 0,
    }));

  // Persist all-time data to DB for future cache hits
  if (speeds.length === 0 && !since) {
    const newestTs = normalized.length > 0
      ? Math.max(...normalized.map((g) => g.createdAt ?? 0))
      : null;
    upsertBotDataCache(
      platform, username, whiteTrie, blackTrie,
      errorProfile, styleMetrics, normalized.length, newestTs,
    ).catch(() => {});
  }

  return { errorProfile, whiteTrie, blackTrie, styleMetrics, gameMoves };
}

/**
 * Build bot data for FIDE players from database PGNs.
 */
async function buildFideBotData(
  username: string,
  since: number | undefined,
): Promise<BotDataResponse | null> {
  const player = await getPlayer(username);
  const sinceDate = since ? new Date(since).toISOString().split("T")[0] : undefined;
  const pgns = await getPlayerGamePgns(username, sinceDate);
  if (!pgns || pgns.length === 0) return null;

  const playerName = player?.name || username;
  const formattedName = formatPlayerName(playerName);
  const allPgn = pgns.join("\n\n");
  const otbGames = parseAllPGNGames(allPgn);

  const gameRecords: GameRecord[] = [];
  for (const g of otbGames) {
    if (!g.moves) continue;
    const isWhite = matchesPlayerName(g.white, formattedName);
    const isBlack = matchesPlayerName(g.black, formattedName);
    const playerIsWhite = isWhite && !isBlack ? true
      : isBlack && !isWhite ? false
      : isWhite;
    gameRecords.push({
      moves: g.moves,
      playerColor: (playerIsWhite ? "white" : "black") as "white" | "black",
      result: g.result === "1-0" ? "white" as const
        : g.result === "0-1" ? "black" as const
        : "draw" as const,
    });
  }

  const fidePlatformId = player?.fideId || username;
  const whiteTrie = buildOpeningTrie(gameRecords, "white");
  const blackTrie = buildOpeningTrie(gameRecords, "black");
  const styleMetrics = analyzeStyleFromRecords(gameRecords);

  // Empty error profile for FIDE (no eval data from PGN)
  const emptyPhase = { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 };
  const errorProfile: ErrorProfile = {
    opening: { ...emptyPhase },
    middlegame: { ...emptyPhase },
    endgame: { ...emptyPhase },
    overall: { ...emptyPhase },
    gamesAnalyzed: 0,
  };

  const gameMoves = gameRecords.map((g) => ({
    id: `FIDE:${fidePlatformId}:${crc32(g.moves)}`,
    moves: g.moves,
    playerColor: g.playerColor,
    result: g.result || ("draw" as const),
    hasEvals: false,
  }));

  return { errorProfile, whiteTrie, blackTrie, styleMetrics, gameMoves };
}

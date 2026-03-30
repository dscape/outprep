import { NextRequest, NextResponse } from "next/server";
import { fetchLichessGames } from "@/lib/lichess";
import { fetchChesscomGames } from "@/lib/chesscom";
import type { OpeningTrie, ErrorProfile, GameRecord } from "@outprep/engine";
import { buildOpeningTrie, buildErrorProfileFromEvals } from "@outprep/engine";
import { fromLichessGame, fromChesscomGame, normalizedToGameRecord, normalizedToGameEvalData } from "@/lib/normalized-game";
import type { NormalizedGame } from "@/lib/normalized-game";
import { getPlayer, getPlayerGamePgns, formatPlayerName } from "@/lib/db";
import { parseAllPGNGames } from "@/lib/pgn-parser";
import { matchesPlayerName, crc32 } from "@outprep/engine";

/**
 * Returns the bot data needed to play against an opponent:
 * - Error profile (per-phase mistake rates from evals)
 * - Opening tries (one per color, JSON move trie)
 */

interface BotData {
  errorProfile: ErrorProfile;
  whiteTrie: OpeningTrie;
  blackTrie: OpeningTrie;
  gameMoves: Array<{ id: string; moves: string; playerColor: "white" | "black"; result: "white" | "black" | "draw"; hasEvals: boolean }>;
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
  const platform = request.nextUrl.searchParams.get("platform") || "lichess";
  const cacheKey = `bot:${platform}:${username.toLowerCase()}:${speeds.length > 0 ? speeds.sort().join(",") : "all"}:${since || "all"}`;

  try {
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return NextResponse.json(cached.data);
    }

    let normalized: NormalizedGame[] | null = null;
    let fideGameRecords: GameRecord[] | null = null;
    let fidePlatformId = username;

    if (platform === "fide") {
      // FIDE: fetch PGNs from DB and parse them
      const player = await getPlayer(username);
      fidePlatformId = player?.fideId || username;
      // Apply since filter at the DB level for FIDE games
      const sinceDate = since ? new Date(since).toISOString().split("T")[0] : undefined;
      const pgns = await getPlayerGamePgns(username, sinceDate);
      if (!pgns || pgns.length === 0) {
        return NextResponse.json({ error: "No games found" }, { status: 404 });
      }
      const playerName = player?.name || username;
      const formattedName = formatPlayerName(playerName);
      const allPgn = pgns.join("\n\n");
      const otbGames = parseAllPGNGames(allPgn);
      fideGameRecords = [];
      // Keep original OTB game data for stable ID generation
      const fideOtbGames = otbGames.filter((g) => g.moves);
      for (const g of fideOtbGames) {
          const isWhite = matchesPlayerName(g.white, formattedName);
          const isBlack = matchesPlayerName(g.black, formattedName);
          const playerIsWhite = isWhite && !isBlack ? true
            : isBlack && !isWhite ? false
            : isWhite;
          fideGameRecords.push({
            moves: g.moves,
            playerColor: (playerIsWhite ? "white" : "black") as "white" | "black",
            result: g.result === "1-0" ? "white" as const
              : g.result === "0-1" ? "black" as const
              : "draw" as const,
          });
      }
      console.log(
        `[bot-data] FIDE ${formattedName}: ${pgns.length} PGNs, ${otbGames.length} parsed, ${fideGameRecords.length} with moves` +
        (sinceDate ? ` (since ${sinceDate})` : "")
      );
    } else if (platform === "chesscom") {
      const rawGames = await fetchChesscomGames(username, 2000, since);
      normalized = rawGames.map((g) => fromChesscomGame(g, username));
      // Apply speed filtering on normalized games (Chess.com raw games don't have a speed field)
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

    let errorProfile: ErrorProfile;
    let whiteTrie: OpeningTrie;
    let blackTrie: OpeningTrie;
    let gameMoves: Array<{ id: string; moves: string; playerColor: "white" | "black"; result: "white" | "black" | "draw"; hasEvals: boolean }>;

    if (fideGameRecords) {
      // FIDE path: build from parsed game records (no eval data from PGN)
      const whiteGames = fideGameRecords.filter(g => g.playerColor === "white").length;
      const blackGames = fideGameRecords.filter(g => g.playerColor === "black").length;
      whiteTrie = buildOpeningTrie(fideGameRecords, "white");
      blackTrie = buildOpeningTrie(fideGameRecords, "black");
      console.log(
        `[bot-data] Trie sizes: white=${Object.keys(whiteTrie).length} positions (${whiteGames} games), ` +
        `black=${Object.keys(blackTrie).length} positions (${blackGames} games)`
      );
      const emptyPhase = { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 };
      errorProfile = {
        opening: { ...emptyPhase },
        middlegame: { ...emptyPhase },
        endgame: { ...emptyPhase },
        overall: { ...emptyPhase },
        gamesAnalyzed: 0,
      };
      gameMoves = fideGameRecords.map((g) => ({
        id: `FIDE:${fidePlatformId}:${crc32(g.moves)}`,
        moves: g.moves,
        playerColor: g.playerColor,
        result: g.result || ("draw" as const),
        hasEvals: false,
      }));
    } else {
      const evalData = normalized!
        .map(normalizedToGameEvalData)
        .filter((d): d is NonNullable<typeof d> => d !== null);
      errorProfile = buildErrorProfileFromEvals(evalData);
      const gameRecords = normalized!.map(normalizedToGameRecord);
      whiteTrie = buildOpeningTrie(gameRecords, "white");
      blackTrie = buildOpeningTrie(gameRecords, "black");

      // Extract game moves for client-side batch eval
      // playerColor = the profiled player's color (the opponent we're mimicking)
      // id = game identifier for correlating with stored evals in IndexedDB
      const platformPrefix = platform === "chesscom" ? "CHESSCOM" : "LICHESS";
      gameMoves = normalized!
        .filter((g) => g.moves)
        .map((g) => ({
          id: `${platformPrefix}:${username}:${g.id}`,
          moves: g.moves,
          playerColor: g.playerColor,
          result: g.result || "draw" as const,
          hasEvals: !!g.evals && g.evals.length > 0,
        }));
    }

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

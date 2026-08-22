import { NextRequest, NextResponse } from "next/server";
import { fetchLichessGames } from "@/lib/lichess";
import { fetchChesscomGames } from "@/lib/chesscom";
import type {
  OpeningTrie,
  ErrorProfile,
  GameRecord,
  StyleMetrics,
} from "@outprep/engine";
import {
  analyzeStyleFromRecords,
  buildErrorProfileFromEvals,
  buildOpeningTrie,
  crc32,
  matchesPlayerName,
} from "@outprep/engine";
import {
  fromChesscomGame,
  fromLichessGame,
  normalizedToGameEvalData,
  normalizedToGameRecord,
} from "@/lib/normalized-game";
import type { NormalizedGame } from "@/lib/normalized-game";
import {
  formatPlayerName,
  getBotDataCache,
  getPlayer,
  getPlayerGamePgns,
  upsertBotDataCache,
} from "@/lib/db";
import type { CachedBotGame } from "@/lib/db";
import { parseAllPGNGames } from "@/lib/pgn-parser";
import { isExcludedFideSlug } from "@/lib/player-exclusions";

export interface BotDataResponse {
  errorProfile: ErrorProfile;
  whiteTrie: OpeningTrie;
  blackTrie: OpeningTrie;
  styleMetrics: StyleMetrics;
  gameCount: number;
  bookSource: "memory" | "db-cache" | "db-filtered" | "provider" | "fide-db" | "all-time-fallback";
  requestedScope: "all-time" | "filtered";
  degraded?: boolean;
  gameMoves?: CachedBotGame[];
}

type BotDataPurpose = "play" | "analysis";
type DbBotData = NonNullable<Awaited<ReturnType<typeof getBotDataCache>>>;

const cache = new Map<string, { data: BotDataResponse; expires: number }>();
const TTL = 24 * 60 * 60 * 1000;
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const speeds = normalizeSpeeds(request.nextUrl.searchParams.get("speeds"));
  const since = parseSince(request.nextUrl.searchParams.get("since"));
  const platform = request.nextUrl.searchParams.get("platform") || "lichess";
  const purpose: BotDataPurpose = request.nextUrl.searchParams.get("purpose") === "play"
    ? "play"
    : "analysis";
  const requestedScope = speeds.length > 0 || since ? "filtered" : "all-time";

  if (platform === "fide" && isExcludedFideSlug(username)) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  const memoryCacheKey = [
    "bot",
    platform,
    username.toLowerCase(),
    speeds.join(",") || "all",
    since || "all",
    purpose,
  ].join(":");

  const memoryCached = cache.get(memoryCacheKey);
  if (memoryCached && memoryCached.expires > Date.now()) {
    return json({ ...memoryCached.data, bookSource: "memory" });
  }

  let dbCached: DbBotData | null = null;

  try {
    if (platform === "fide") {
      const data = await buildFideBotData(username, since, purpose);
      if (!data) {
        return NextResponse.json({ error: "No games found" }, { status: 404 });
      }
      remember(memoryCacheKey, data);
      return json(data);
    }

    dbCached = await getBotDataCache(platform, username);

    if (
      requestedScope === "all-time" &&
      hasCachedBook(dbCached) &&
      (purpose === "play" || !!dbCached.gameMoves?.length)
    ) {
      const data = fromDbCache(dbCached, purpose, "db-cache", requestedScope);
      remember(memoryCacheKey, data);
      return json(data);
    }

    if (requestedScope === "filtered" && dbCached?.gameMoves?.length) {
      const filteredGames = filterCachedGames(dbCached.gameMoves, speeds, since);
      const data = buildFromCachedGames(
        filteredGames,
        dbCached.errorProfile as ErrorProfile,
        purpose,
      );
      remember(memoryCacheKey, data);
      return json(data);
    }

    const data = await buildOnlineBotData(
      platform,
      username,
      speeds,
      since,
      purpose,
    );
    remember(memoryCacheKey, data);
    return json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Personalized practice must never silently become a bookless engine game.
    // A stale all-time repertoire remains safer and more truthful than null tries.
    if (purpose === "play" && hasCachedBook(dbCached)) {
      const fallback = fromDbCache(
        dbCached,
        purpose,
        "all-time-fallback",
        requestedScope,
        true,
      );
      console.warn("[bot-data] provider failed; using cached repertoire", {
        platform,
        username,
        requestedScope,
        error: message,
      });
      remember(memoryCacheKey, fallback);
      return json(fallback);
    }

    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Rate limited")) {
      return NextResponse.json(
        { error: message },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function json(data: BotDataResponse) {
  return NextResponse.json(data, {
    headers: {
      ...CACHE_HEADERS,
      "X-Outprep-Bot-Data-Source": data.bookSource,
    },
  });
}

function remember(key: string, data: BotDataResponse): void {
  cache.set(key, { data, expires: Date.now() + TTL });
}

function normalizeSpeeds(value: string | null): string[] {
  return value
    ? [...new Set(value.split(",").map((speed) => speed.trim()).filter(Boolean))].sort()
    : [];
}

function parseSince(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function hasCachedBook(data: DbBotData | null): data is DbBotData {
  return !!data &&
    isTrie(data.whiteTrie) &&
    isTrie(data.blackTrie) &&
    (Object.keys(data.whiteTrie).length > 0 || Object.keys(data.blackTrie).length > 0);
}

function isTrie(value: unknown): value is OpeningTrie {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fromDbCache(
  cached: DbBotData,
  purpose: BotDataPurpose,
  bookSource: BotDataResponse["bookSource"],
  requestedScope: BotDataResponse["requestedScope"],
  degraded = false,
): BotDataResponse {
  return {
    whiteTrie: cached.whiteTrie as OpeningTrie,
    blackTrie: cached.blackTrie as OpeningTrie,
    errorProfile: cached.errorProfile as ErrorProfile,
    styleMetrics: cached.styleMetrics as StyleMetrics,
    gameCount: cached.gameCount,
    bookSource,
    requestedScope,
    ...(degraded ? { degraded: true } : {}),
    ...(purpose === "analysis" && cached.gameMoves
      ? { gameMoves: cached.gameMoves }
      : {}),
  };
}

function filterCachedGames(
  games: CachedBotGame[],
  speeds: string[],
  since: number | undefined,
): CachedBotGame[] {
  return games.filter((game) =>
    (speeds.length === 0 || (!!game.speed && speeds.includes(game.speed))) &&
    (!since || (game.createdAt ?? 0) >= since),
  );
}

function buildFromCachedGames(
  games: CachedBotGame[],
  errorProfile: ErrorProfile,
  purpose: BotDataPurpose,
): BotDataResponse {
  const records: GameRecord[] = games.map((game) => ({
    moves: game.moves,
    playerColor: game.playerColor,
    result: game.result,
  }));
  return {
    errorProfile,
    whiteTrie: buildOpeningTrie(records, "white"),
    blackTrie: buildOpeningTrie(records, "black"),
    styleMetrics: analyzeStyleFromRecords(records),
    gameCount: games.length,
    bookSource: "db-filtered",
    requestedScope: "filtered",
    ...(purpose === "analysis" ? { gameMoves: games } : {}),
  };
}

async function buildOnlineBotData(
  platform: string,
  username: string,
  speeds: string[],
  since: number | undefined,
  purpose: BotDataPurpose,
): Promise<BotDataResponse> {
  let normalized: NormalizedGame[];

  if (platform === "chesscom") {
    const rawGames = await fetchChesscomGames(username, 2000, since);
    normalized = rawGames.map((game) => fromChesscomGame(game, username));
    if (speeds.length > 0) {
      normalized = normalized.filter((game) => game.speed && speeds.includes(game.speed));
    }
  } else {
    const rawGames = await fetchLichessGames(username, 2000);
    let filtered = rawGames.filter((game) => game.variant === "standard");
    if (speeds.length > 0) {
      filtered = filtered.filter((game) => speeds.includes(game.speed));
    }
    if (since) {
      filtered = filtered.filter((game) => (game.createdAt ?? 0) >= since);
    }
    normalized = filtered.map((game) => fromLichessGame(game, username));
  }

  const evalData = normalized
    .map(normalizedToGameEvalData)
    .filter((data): data is NonNullable<typeof data> => data !== null);
  const errorProfile = buildErrorProfileFromEvals(evalData);
  const gameRecords = normalized.map(normalizedToGameRecord);
  const whiteTrie = buildOpeningTrie(gameRecords, "white");
  const blackTrie = buildOpeningTrie(gameRecords, "black");
  const styleMetrics = analyzeStyleFromRecords(gameRecords);
  const gameMoves = toCachedGameMoves(platform, username, normalized);

  if (speeds.length === 0 && !since) {
    const newestTs = normalized.length > 0
      ? Math.max(...normalized.map((game) => game.createdAt ?? 0))
      : null;
    void upsertBotDataCache(
      platform,
      username,
      whiteTrie,
      blackTrie,
      errorProfile,
      styleMetrics,
      normalized.length,
      newestTs,
      gameMoves,
    );
  }

  return {
    errorProfile,
    whiteTrie,
    blackTrie,
    styleMetrics,
    gameCount: normalized.length,
    bookSource: "provider",
    requestedScope: speeds.length > 0 || since ? "filtered" : "all-time",
    ...(purpose === "analysis" ? { gameMoves } : {}),
  };
}

function toCachedGameMoves(
  platform: string,
  username: string,
  games: NormalizedGame[],
): CachedBotGame[] {
  const prefix = platform === "chesscom" ? "CHESSCOM" : "LICHESS";
  return games
    .filter((game) => game.moves)
    .map((game) => ({
      id: `${prefix}:${username}:${game.id}`,
      moves: game.moves,
      playerColor: game.playerColor,
      result: game.result ?? "draw",
      hasEvals: !!game.evals?.length,
      speed: game.speed,
      createdAt: game.createdAt,
    }));
}

async function buildFideBotData(
  username: string,
  since: number | undefined,
  purpose: BotDataPurpose,
): Promise<BotDataResponse | null> {
  const player = await getPlayer(username);
  if (!player) return null;

  const sinceDate = since ? new Date(since).toISOString().split("T")[0] : undefined;
  const pgns = await getPlayerGamePgns(username, sinceDate);
  if (!pgns?.length) return null;

  const formattedName = formatPlayerName(player.name);
  const otbGames = parseAllPGNGames(pgns.join("\n\n"));
  const gameRecords: GameRecord[] = [];

  for (const game of otbGames) {
    if (!game.moves) continue;
    const isWhite = matchesPlayerName(game.white, formattedName);
    const isBlack = matchesPlayerName(game.black, formattedName);
    const playerIsWhite = isWhite && !isBlack ? true : isBlack && !isWhite ? false : isWhite;
    gameRecords.push({
      moves: game.moves,
      playerColor: playerIsWhite ? "white" : "black",
      result: game.result === "1-0" ? "white" : game.result === "0-1" ? "black" : "draw",
    });
  }

  const whiteTrie = buildOpeningTrie(gameRecords, "white");
  const blackTrie = buildOpeningTrie(gameRecords, "black");
  const styleMetrics = analyzeStyleFromRecords(gameRecords);
  const emptyPhase = {
    totalMoves: 0,
    mistakes: 0,
    blunders: 0,
    avgCPL: 0,
    errorRate: 0,
    blunderRate: 0,
  };
  const errorProfile: ErrorProfile = {
    opening: { ...emptyPhase },
    middlegame: { ...emptyPhase },
    endgame: { ...emptyPhase },
    overall: { ...emptyPhase },
    gamesAnalyzed: 0,
  };
  const gameMoves: CachedBotGame[] = gameRecords.map((game) => ({
    id: `FIDE:${player.fideId}:${crc32(game.moves)}`,
    moves: game.moves,
    playerColor: game.playerColor,
    result: game.result ?? "draw",
    hasEvals: false,
  }));

  return {
    errorProfile,
    whiteTrie,
    blackTrie,
    styleMetrics,
    gameCount: gameRecords.length,
    bookSource: "fide-db",
    requestedScope: since ? "filtered" : "all-time",
    ...(purpose === "analysis" ? { gameMoves } : {}),
  };
}

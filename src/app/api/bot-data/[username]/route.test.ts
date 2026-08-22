import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  fetchLichessGames: vi.fn(),
  fetchChesscomGames: vi.fn(),
  getBotDataCache: vi.fn(),
  getPlayer: vi.fn(),
  getPlayerGamePgns: vi.fn(),
  upsertBotDataCache: vi.fn(),
}));

vi.mock("@/lib/lichess", () => ({ fetchLichessGames: mocks.fetchLichessGames }));
vi.mock("@/lib/chesscom", () => ({ fetchChesscomGames: mocks.fetchChesscomGames }));
vi.mock("@/lib/db", () => ({
  formatPlayerName: (name: string) => name,
  getBotDataCache: mocks.getBotDataCache,
  getPlayer: mocks.getPlayer,
  getPlayerGamePgns: mocks.getPlayerGamePgns,
  upsertBotDataCache: mocks.upsertBotDataCache,
}));

import { GET } from "./route";

const position = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const profile = {
  opening: { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 },
  middlegame: { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 },
  endgame: { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 },
  overall: { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 },
  gamesAnalyzed: 0,
};
const style = { aggression: 50, tactical: 50, positional: 50, endgame: 50, sampleSize: 1 };

function cached(gameMoves: unknown[] | null = null) {
  return {
    whiteTrie: { [position]: { totalGames: 2, moves: [{ uci: "e2e4", san: "e4", count: 2, winRate: 0.5 }] } },
    blackTrie: { "after-e4": { totalGames: 2, moves: [{ uci: "e7e5", san: "e5", count: 2, winRate: 0.5 }] } },
    errorProfile: profile,
    styleMetrics: style,
    gameMoves,
    gameCount: 972,
    newestGameTs: 1,
    updatedAt: new Date(),
  };
}

async function request(username: string, query: string) {
  return GET(
    new NextRequest(`http://localhost/api/bot-data/${username}?${query}`),
    { params: Promise.resolve({ username }) },
  );
}

describe("bot-data play contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses a validated all-time DB repertoire when filtered provider fetch is rate limited", async () => {
    mocks.getBotDataCache.mockResolvedValue(cached());
    mocks.fetchLichessGames.mockRejectedValue(new Error("Rate limited by Lichess. Please try again shortly."));

    const response = await request("fallback-user", "purpose=play&speeds=blitz");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookSource).toBe("all-time-fallback");
    expect(body.degraded).toBe(true);
    expect(body.gameCount).toBe(972);
    expect(body.gameMoves).toBeUndefined();
  });

  it("rebuilds filtered tries from cached game moves without hitting the provider", async () => {
    mocks.getBotDataCache.mockResolvedValue(cached([
      {
        id: "LICHESS:cached-user:1",
        moves: "e4 e5 Nf3 Nc6",
        playerColor: "white",
        result: "white",
        hasEvals: false,
        speed: "blitz",
        createdAt: 100,
      },
      {
        id: "LICHESS:cached-user:2",
        moves: "e4 e5 Bc4 Nc6",
        playerColor: "white",
        result: "draw",
        hasEvals: false,
        speed: "blitz",
        createdAt: 100,
      },
      {
        id: "LICHESS:cached-user:3",
        moves: "d4 d5 c4 e6",
        playerColor: "white",
        result: "draw",
        hasEvals: false,
        speed: "rapid",
        createdAt: 100,
      },
    ]));

    const response = await request("cached-user", "purpose=play&speeds=blitz");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookSource).toBe("db-filtered");
    expect(body.gameCount).toBe(2);
    expect(mocks.fetchLichessGames).not.toHaveBeenCalled();
  });

  it("returns 404 for an excluded FIDE slug before reading any game data", async () => {
    const response = await request("removed-player-2225972", "purpose=play&platform=fide");

    expect(response.status).toBe(404);
    expect(mocks.getPlayer).not.toHaveBeenCalled();
    expect(mocks.getPlayerGamePgns).not.toHaveBeenCalled();
  });
});

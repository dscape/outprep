import { describe, expect, it } from "vitest";
import { aggregatePlayers } from "./aggregate";
import { buildGameDetails } from "./game-indexer";
import { derivePlayerAggregates } from "./excluded-player-purge";
import type { FIDEPlayer, TWICGameHeader } from "./types";

function game(overrides: Partial<TWICGameHeader> = {}): TWICGameHeader {
  return {
    white: "Allowed, Alice",
    black: "Allowed, Bob",
    whiteElo: 1800,
    blackElo: 1700,
    whiteTitle: null,
    blackTitle: null,
    whiteFideId: "1111111",
    blackFideId: "3333333",
    eco: "C20",
    opening: "King's Pawn Game",
    event: "Safe Event",
    site: "Somewhere",
    date: "2025.01.01",
    result: "1-0",
    rawPgn: "[Event \"Safe Event\"]\n[Round \"1\"]\n\n1. e4 e5 1-0",
    ...overrides,
  };
}

function player(fideId: string, slug: string, name: string): FIDEPlayer {
  return {
    fideId,
    slug,
    name,
    aliases: [],
    fideRating: 1800,
    title: null,
    gameCount: 1,
    recentEvents: [],
    lastSeen: "2025.01.01",
    openings: { white: [], black: [] },
    winRate: 0,
    drawRate: 0,
    lossRate: 0,
  };
}

describe("configured FIDE exclusions", () => {
  it("drops the entire game before either player is aggregated", () => {
    const players = aggregatePlayers([
      game({ black: "Segura Ariza, Jose Luis", blackFideId: "2225972" }),
      game({ date: "2025.01.02" }),
    ], 1);

    expect(players.map((entry) => entry.fideId)).toEqual(["1111111", "3333333"]);
    expect(players.find((entry) => entry.fideId === "1111111")?.gameCount).toBe(1);
  });

  it("never builds a detail page or alias source for an excluded game", () => {
    const games = buildGameDetails(
      [game({ black: "Segura Ariza, Jose Luis", blackFideId: "2225972" })],
      [
        player("1111111", "alice-1111111", "Allowed, Alice"),
        player("2225972", "removed-2225972", "Segura Ariza, Jose Luis"),
      ],
    );

    expect(games).toEqual([]);
  });

  it("rebuilds an opponent aggregate only from remaining games", () => {
    const stats = derivePlayerAggregates([
      {
        slug: "safe-game",
        white_name: "Allowed, Alice",
        black_name: "Allowed, Bob",
        white_slug: "alice-1111111",
        black_slug: "bob-3333333",
        white_fide_id: "1111111",
        black_fide_id: "3333333",
        white_elo: 1800,
        black_elo: 1700,
        event: "Safe Event",
        date: new Date("2025-01-02T00:00:00Z"),
        opening: "King's Pawn Game",
        eco: "C20",
        result: "1-0",
      },
    ], "1111111", "alice-1111111");

    expect(stats.gameCount).toBe(1);
    expect(stats.fideRating).toBe(1800);
    expect(stats.recentGames.map((entry) => entry.slug)).toEqual(["safe-game"]);
    expect(JSON.stringify(stats)).not.toContain("2225972");
    expect(JSON.stringify(stats)).not.toContain("Segura");
  });
});

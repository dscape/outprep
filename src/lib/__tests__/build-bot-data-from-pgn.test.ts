import { describe, it, expect } from "vitest";
import { buildBotDataFromProfile } from "@/lib/build-bot-data-from-pgn";
import type { OTBProfile } from "@/lib/types";

function makeProfile(overrides: Partial<OTBProfile> = {}): OTBProfile {
  return {
    username: "TestPlayer",
    platform: "pgn",
    totalGames: 2,
    analyzedGames: 2,
    style: { aggression: 50, tactical: 50, positional: 50, endgame: 50, sampleSize: 2 },
    weaknesses: [],
    openings: { white: [], black: [] },
    prepTips: [],
    lastComputed: Date.now(),
    games: [
      {
        white: "TestPlayer",
        black: "Opponent One",
        result: "1-0",
        date: "2024.01.15",
        event: "Test Tournament",
        moves: "e4 e5 Nf3 Nc6 Bb5 a6",
      },
      {
        white: "Opponent Two",
        black: "TestPlayer",
        result: "0-1",
        date: "2024.01.16",
        event: "Test Tournament",
        moves: "d4 Nf6 c4 e6 Nc3 Bb4",
      },
    ],
    ...overrides,
  };
}

describe("buildBotDataFromProfile", () => {
  it("returns valid BotData with opening tries from PGN games", () => {
    const profile = makeProfile();
    const result = buildBotDataFromProfile(profile, "TestPlayer");

    expect(result).not.toBeNull();
    expect(result!.whiteTrie).toBeDefined();
    expect(result!.blackTrie).toBeDefined();
    expect(result!.errorProfile).toBeDefined();
    expect(result!.styleMetrics).toBeDefined();
  });

  it("builds white trie from games where player is white", () => {
    const profile = makeProfile();
    const result = buildBotDataFromProfile(profile, "TestPlayer")!;

    // White trie should have at least the root with e4 as a child
    expect(result.whiteTrie).toBeDefined();
    expect(Object.keys(result.whiteTrie).length).toBeGreaterThan(0);
  });

  it("builds black trie from games where player is black", () => {
    const profile = makeProfile();
    const result = buildBotDataFromProfile(profile, "TestPlayer")!;

    // Black trie should have at least the root with Nf6 response
    expect(result.blackTrie).toBeDefined();
    expect(Object.keys(result.blackTrie).length).toBeGreaterThan(0);
  });

  it("produces empty error profile (no eval data from PGN)", () => {
    const profile = makeProfile();
    const result = buildBotDataFromProfile(profile, "TestPlayer")!;

    expect(result.errorProfile.gamesAnalyzed).toBe(0);
    expect(result.errorProfile.opening.totalMoves).toBe(0);
    expect(result.errorProfile.middlegame.totalMoves).toBe(0);
    expect(result.errorProfile.endgame.totalMoves).toBe(0);
    expect(result.errorProfile.overall.totalMoves).toBe(0);
  });

  it("produces default style metrics with sampleSize 0", () => {
    const profile = makeProfile();
    const result = buildBotDataFromProfile(profile, "TestPlayer")!;

    expect(result.styleMetrics.sampleSize).toBe(0);
    expect(result.styleMetrics.aggression).toBe(50);
    expect(result.styleMetrics.tactical).toBe(50);
  });

  it("returns null when profile has no games", () => {
    const profile = makeProfile({ games: [] });
    const result = buildBotDataFromProfile(profile, "TestPlayer");
    expect(result).toBeNull();
  });

  it("returns null when profile has undefined games", () => {
    const profile = makeProfile({ games: undefined });
    const result = buildBotDataFromProfile(profile, "TestPlayer");
    expect(result).toBeNull();
  });

  it("skips games with no moves", () => {
    const profile = makeProfile({
      games: [
        {
          white: "TestPlayer",
          black: "Opponent",
          result: "1-0",
          date: "2024.01.15",
          event: "Test",
          moves: "",
        },
      ],
    });
    const result = buildBotDataFromProfile(profile, "TestPlayer");
    // Empty moves string is falsy, so this game is filtered out → null
    expect(result).toBeNull();
  });

  it("correctly assigns player color when player name appears in white", () => {
    const profile = makeProfile({
      games: [
        {
          white: "TestPlayer",
          black: "Other",
          result: "1-0",
          date: "2024.01.15",
          event: "Test",
          moves: "e4 e5 Nf3 Nc6",
        },
      ],
    });
    const result = buildBotDataFromProfile(profile, "TestPlayer")!;

    // White trie should have data (player was white)
    expect(Object.keys(result.whiteTrie).length).toBeGreaterThan(0);
  });

  it("correctly assigns player color when player name appears in black", () => {
    const profile = makeProfile({
      games: [
        {
          white: "Other",
          black: "TestPlayer",
          result: "0-1",
          date: "2024.01.15",
          event: "Test",
          moves: "d4 Nf6 c4 e6",
        },
      ],
    });
    const result = buildBotDataFromProfile(profile, "TestPlayer")!;

    // Black trie should have data (player was black)
    expect(Object.keys(result.blackTrie).length).toBeGreaterThan(0);
  });

  it("handles case-insensitive player name matching", () => {
    const profile = makeProfile({
      games: [
        {
          white: "testplayer",
          black: "Other",
          result: "1-0",
          date: "2024.01.15",
          event: "Test",
          moves: "e4 e5 Nf3 Nc6",
        },
      ],
    });
    const result = buildBotDataFromProfile(profile, "TestPlayer");
    expect(result).not.toBeNull();
    expect(Object.keys(result!.whiteTrie).length).toBeGreaterThan(0);
  });
});

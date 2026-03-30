import { describe, it, expect } from "vitest";
import {
  parseElo,
  parseFideId,
  parseTitle,
  splitPGN,
  parseGames,
  generateGameSlug,
  generatePlayerSlug,
  type ParsedGame,
} from "@/lib/pipeline/twic-incremental";

describe("parseElo", () => {
  it("returns null for empty/missing values", () => {
    expect(parseElo(undefined)).toBeNull();
    expect(parseElo("")).toBeNull();
    expect(parseElo("-")).toBeNull();
    expect(parseElo("0")).toBeNull();
  });

  it("returns null for ratings below 100", () => {
    expect(parseElo("99")).toBeNull();
    expect(parseElo("50")).toBeNull();
  });

  it("parses valid ratings", () => {
    expect(parseElo("2800")).toBe(2800);
    expect(parseElo("1500")).toBe(1500);
    expect(parseElo("100")).toBe(100);
  });

  it("returns null for non-numeric strings", () => {
    expect(parseElo("abc")).toBeNull();
  });
});

describe("parseFideId", () => {
  it("returns null for empty/missing values", () => {
    expect(parseFideId(undefined)).toBeNull();
    expect(parseFideId("")).toBeNull();
    expect(parseFideId("0")).toBeNull();
    expect(parseFideId("-")).toBeNull();
  });

  it("returns trimmed numeric IDs", () => {
    expect(parseFideId("1503014")).toBe("1503014");
    expect(parseFideId("  1503014  ")).toBe("1503014");
  });

  it("returns null for non-numeric IDs", () => {
    expect(parseFideId("abc123")).toBeNull();
    expect(parseFideId("12.34")).toBeNull();
  });
});

describe("parseTitle", () => {
  it("returns null for empty/missing values", () => {
    expect(parseTitle(undefined)).toBeNull();
    expect(parseTitle("")).toBeNull();
    expect(parseTitle("-")).toBeNull();
  });

  it("normalises valid titles to uppercase", () => {
    expect(parseTitle("GM")).toBe("GM");
    expect(parseTitle("gm")).toBe("GM");
    expect(parseTitle("  im  ")).toBe("IM");
    expect(parseTitle("WGM")).toBe("WGM");
  });

  it("returns null for unknown titles", () => {
    expect(parseTitle("GML")).toBeNull();
    expect(parseTitle("Candidate")).toBeNull();
  });
});

describe("splitPGN", () => {
  it("returns a single game when no split marker present", () => {
    const pgn = '[Event "Test"]\n[White "A"]\n[Black "B"]\n\n1. e4 *';
    const games = splitPGN(pgn);
    expect(games).toHaveLength(1);
    expect(games[0]).toContain('[Event "Test"]');
  });

  it("splits multiple games on blank-line before [Event", () => {
    const pgn =
      '[Event "A"]\n[White "X"]\n1. e4 *\n\n[Event "B"]\n[White "Y"]\n1. d4 *';
    const games = splitPGN(pgn);
    expect(games).toHaveLength(2);
    expect(games[0]).toContain('[Event "A"]');
    expect(games[1]).toContain('[Event "B"]');
  });

  it("filters empty strings", () => {
    const games = splitPGN("   ");
    expect(games).toHaveLength(0);
  });
});

// Minimal valid two-game PGN for parseGames tests
const TWO_GAME_PGN = `[Event "Test Open"]
[Site "Test City"]
[Date "2024.01.15"]
[Round "1"]
[White "Carlsen, Magnus"]
[Black "Caruana, Fabiano"]
[Result "1-0"]
[WhiteElo "2830"]
[BlackElo "2800"]
[WhiteFideId "1503014"]
[BlackFideId "2020009"]
[ECO "C65"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 1-0

[Event "Test Open"]
[Site "Test City"]
[Date "2024.01.15"]
[Round "2"]
[White "Nakamura, Hikaru"]
[Black "So, Wesley"]
[Result "1/2-1/2"]
[WhiteElo "2780"]
[BlackElo "2770"]
[WhiteFideId "2016192"]
[BlackFideId "5202213"]
[ECO "D37"]

1. d4 d5 2. c4 e6 3. Nf3 Nf6 1/2-1/2`;

describe("parseGames", () => {
  it("parses two valid games", () => {
    const games = parseGames(TWO_GAME_PGN);
    expect(games).toHaveLength(2);
  });

  it("extracts player names, ratings and FIDE IDs", () => {
    const games = parseGames(TWO_GAME_PGN);
    const g = games[0];
    expect(g.white).toBe("Carlsen, Magnus");
    expect(g.black).toBe("Caruana, Fabiano");
    expect(g.whiteElo).toBe(2830);
    expect(g.blackElo).toBe(2800);
    expect(g.whiteFideId).toBe("1503014");
    expect(g.blackFideId).toBe("2020009");
    expect(g.result).toBe("1-0");
    expect(g.eco).toBe("C65");
  });

  it("skips games with result '*'", () => {
    const pgn = `[Event "Test"]\n[White "A, B"]\n[Black "C, D"]\n[Result "*"]\n[WhiteElo "2500"]\n[BlackElo "2500"]\n[WhiteFideId "111"]\n[BlackFideId "222"]\n\n1. e4 *`;
    const games = parseGames(pgn);
    expect(games).toHaveLength(0);
  });

  it("skips games with unknown players ('?')", () => {
    const pgn = `[Event "Test"]\n[White "?"]\n[Black "C, D"]\n[Result "1-0"]\n[WhiteElo "2500"]\n[BlackElo "2500"]\n\n1. e4 1-0`;
    const games = parseGames(pgn);
    expect(games).toHaveLength(0);
  });

  it("skips games where both elos are null", () => {
    const pgn = `[Event "Test"]\n[White "A, B"]\n[Black "C, D"]\n[Result "1-0"]\n\n1. e4 1-0`;
    const games = parseGames(pgn);
    expect(games).toHaveLength(0);
  });
});

const SAMPLE_GAME: ParsedGame = {
  white: "Carlsen, Magnus",
  black: "Caruana, Fabiano",
  whiteFideId: "1503014",
  blackFideId: "2020009",
  whiteElo: 2830,
  blackElo: 2800,
  whiteTitle: "GM",
  blackTitle: "GM",
  event: "World Chess Championship 2024",
  site: "New York",
  date: "2024.11.01",
  round: "1",
  result: "1-0",
  eco: "C65",
  opening: "Ruy Lopez",
  variation: "Berlin",
  pgn: '[Event "World Chess Championship 2024"]\n1. e4 e5 1-0',
};

describe("generateGameSlug", () => {
  it("produces a deterministic slug", () => {
    const slug = generateGameSlug(SAMPLE_GAME);
    expect(slug).toBe(
      "world-chess-championship-2024-r1-2024/carlsen-1503014-vs-caruana-2020009",
    );
  });

  it("falls back to matchup-only slug when event or date is missing", () => {
    const g = { ...SAMPLE_GAME, event: null };
    const slug = generateGameSlug(g);
    expect(slug).not.toContain("/");
    expect(slug).toContain("carlsen");
    expect(slug).toContain("caruana");
  });

  it("strips diacritics", () => {
    const g = { ...SAMPLE_GAME, white: "Gledura, Benjámin", whiteFideId: "123" };
    const slug = generateGameSlug(g);
    expect(slug).toContain("gledura");
    expect(slug).not.toMatch(/[àáâãäåèéêëìíîïòóôõöùúûü]/i);
  });
});

describe("generatePlayerSlug", () => {
  it("combines first and last name with FIDE ID", () => {
    expect(generatePlayerSlug("Carlsen, Magnus", "1503014")).toBe(
      "magnus-carlsen-1503014",
    );
  });

  it("falls back to last name only when no comma", () => {
    expect(generatePlayerSlug("Carlsen", "1503014")).toBe("carlsen-1503014");
  });

  it("lowercases and strips diacritics", () => {
    expect(generatePlayerSlug("Gledura, Benjámin", "999")).toBe(
      "benjamin-gledura-999",
    );
  });
});

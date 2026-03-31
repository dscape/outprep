import { describe, it, expect } from "vitest";
import {
  extractMoveText,
  normalizeMoves,
  computeFingerprint,
  countMoves,
  extractSourceKey,
  parseBroadcastGames,
} from "@/lib/pipeline/lichess-broadcasts";

// ─── normalizeMoves ─────────────────────────────────────────────────────────

describe("normalizeMoves", () => {
  it("strips clock annotations", () => {
    const moves =
      "1. e4 { [%clk 1:59:51] } 1... e5 { [%clk 1:59:49] } 2. Nf3 Nc6";
    expect(normalizeMoves(moves)).toBe("e4 e5 Nf3 Nc6");
  });

  it("strips eval annotations", () => {
    const moves = "1. e4 { [%eval 0.12] } 1... e5 { [%eval 0.25] }";
    expect(normalizeMoves(moves)).toBe("e4 e5");
  });

  it("strips text comments", () => {
    const moves = "1. e4 { Inaccuracy. d4 was best. } 1... e5";
    expect(normalizeMoves(moves)).toBe("e4 e5");
  });

  it("strips NAGs", () => {
    const moves = "1. e4 $1 1... e5 $2 2. Nf3 $6";
    expect(normalizeMoves(moves)).toBe("e4 e5 Nf3");
  });

  it("strips move numbers including ellipsis", () => {
    const moves = "1. e4 1... e5 2. Nf3 2... Nc6 42. Qg7#";
    expect(normalizeMoves(moves)).toBe("e4 e5 Nf3 Nc6 Qg7#");
  });

  it("strips result tokens", () => {
    expect(normalizeMoves("1. e4 e5 1-0")).toBe("e4 e5");
    expect(normalizeMoves("1. e4 e5 0-1")).toBe("e4 e5");
    expect(normalizeMoves("1. e4 e5 1/2-1/2")).toBe("e4 e5");
    expect(normalizeMoves("1. e4 e5 *")).toBe("e4 e5");
  });

  it("collapses whitespace", () => {
    const moves = "1. e4   e5  \n  2. Nf3  Nc6";
    expect(normalizeMoves(moves)).toBe("e4 e5 Nf3 Nc6");
  });

  it("handles empty input", () => {
    expect(normalizeMoves("")).toBe("");
    expect(normalizeMoves("*")).toBe("");
    expect(normalizeMoves("1-0")).toBe("");
  });

  it("produces identical output for TWIC and Lichess formats of the same game", () => {
    // TWIC format: clean SAN
    const twic = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0";

    // Lichess format: with clocks and evals
    const lichess =
      '1. e4 { [%eval 0.18] [%clk 1:59:54] } 1... e5 { [%eval 0.22] [%clk 1:58:44] } 2. Nf3 { [%eval 0.29] [%clk 1:59:45] } 2... Nc6 { [%eval 0.31] [%clk 1:58:30] } 3. Bb5 { [%eval 0.28] [%clk 1:59:23] } 3... a6 { [%eval 0.32] [%clk 1:57:53] } 1-0';

    expect(normalizeMoves(twic)).toBe(normalizeMoves(lichess));
    expect(normalizeMoves(twic)).toBe("e4 e5 Nf3 Nc6 Bb5 a6");
  });
});

// ─── extractMoveText ────────────────────────────────────────────────────────

describe("extractMoveText", () => {
  it("extracts moves after headers", () => {
    const pgn =
      '[Event "Test"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 1-0';
    expect(extractMoveText(pgn)).toContain("1. e4 e5 2. Nf3 1-0");
  });

  it("handles PGN without blank line separator", () => {
    const pgn = '[Event "Test"]\n1. e4 e5 1-0';
    expect(extractMoveText(pgn)).toContain("1. e4 e5 1-0");
  });

  it("returns empty for header-only PGN", () => {
    const pgn = '[Event "Test"]\n[White "A"]';
    expect(extractMoveText(pgn)).toBe("");
  });
});

// ─── computeFingerprint ─────────────────────────────────────────────────────

describe("computeFingerprint", () => {
  it("is deterministic", () => {
    const fp1 = computeFingerprint("2024.01.15", "1503014", "2020009", "e4 e5 Nf3 Nc6");
    const fp2 = computeFingerprint("2024.01.15", "1503014", "2020009", "e4 e5 Nf3 Nc6");
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64); // SHA-256 hex
  });

  it("differs when any input changes", () => {
    const base = computeFingerprint("2024.01.15", "1503014", "2020009", "e4 e5");
    const diffDate = computeFingerprint("2024.01.16", "1503014", "2020009", "e4 e5");
    const diffWhite = computeFingerprint("2024.01.15", "9999999", "2020009", "e4 e5");
    const diffBlack = computeFingerprint("2024.01.15", "1503014", "9999999", "e4 e5");
    const diffMoves = computeFingerprint("2024.01.15", "1503014", "2020009", "d4 d5");

    expect(base).not.toBe(diffDate);
    expect(base).not.toBe(diffWhite);
    expect(base).not.toBe(diffBlack);
    expect(base).not.toBe(diffMoves);
  });

  it("matches for the same game in TWIC vs Lichess format", () => {
    const twicMoves = normalizeMoves("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0");
    const lichessMoves = normalizeMoves(
      '1. e4 { [%eval 0.18] [%clk 1:59:54] } 1... e5 { [%eval 0.22] } 2. Nf3 { [%clk 1:59:45] } 2... Nc6 3. Bb5 3... a6 1-0',
    );

    const fp1 = computeFingerprint("2024.01.15", "1503014", "2020009", twicMoves);
    const fp2 = computeFingerprint("2024.01.15", "1503014", "2020009", lichessMoves);
    expect(fp1).toBe(fp2);
  });
});

// ─── countMoves ─────────────────────────────────────────────────────────────

describe("countMoves", () => {
  it("counts SAN moves", () => {
    expect(countMoves("e4 e5 Nf3 Nc6 Bb5 a6")).toBe(6);
  });

  it("returns 0 for empty", () => {
    expect(countMoves("")).toBe(0);
  });

  it("handles single move", () => {
    expect(countMoves("e4")).toBe(1);
  });
});

// ─── extractSourceKey ───────────────────────────────────────────────────────

describe("extractSourceKey", () => {
  it("extracts chapter ID from GameURL", () => {
    expect(
      extractSourceKey(
        "https://lichess.org/broadcast/fide-candidates-2026-open/round-2/FRTlzP2X/q1PvC2Uo",
      ),
    ).toBe("q1PvC2Uo");
  });

  it("extracts from minimal URL", () => {
    expect(
      extractSourceKey(
        "https://lichess.org/broadcast/slug/round/AbCdEfGh/XyZwVuTs",
      ),
    ).toBe("XyZwVuTs");
  });

  it("returns null for null input", () => {
    expect(extractSourceKey(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractSourceKey("")).toBeNull();
  });

  it("returns null if last segment isn't 8-char alphanumeric", () => {
    expect(extractSourceKey("https://lichess.org/broadcast/slug")).toBeNull();
    expect(extractSourceKey("https://lichess.org/broadcast/short/Ab")).toBeNull();
  });
});

// ─── parseBroadcastGames ────────────────────────────────────────────────────

const LICHESS_PGN = `[Event "FIDE Candidates Tournament 2026"]
[Site "https://lichess.org/broadcast/fide-candidates-2026-open/round-2/FRTlzP2X/q1PvC2Uo"]
[Date "2026.03.02"]
[Round "2.4"]
[White "Esipenko, Andrey"]
[Black "Nakamura, Hikaru"]
[Result "1/2-1/2"]
[WhiteElo "2698"]
[WhiteTitle "GM"]
[WhiteFideId "24175439"]
[BlackElo "2810"]
[BlackTitle "GM"]
[BlackFideId "2016192"]
[TimeControl "120+30"]
[Variant "Standard"]
[ECO "A13"]
[Opening "English Opening: Agincourt Defense"]
[UTCDate "2026.03.02"]
[UTCTime "17:15:59"]
[BroadcastName "FIDE Candidates 2026: Open"]
[BroadcastURL "https://lichess.org/broadcast/fide-candidates-2026-open/round-2/FRTlzP2X"]
[GameURL "https://lichess.org/broadcast/fide-candidates-2026-open/round-2/FRTlzP2X/q1PvC2Uo"]

1. c4 { [%eval 0.12] [%clk 1:59:51] } 1... e6 { [%eval 0.25] [%clk 1:59:49] } 2. g3 { [%eval 0.14] [%clk 1:59:40] } 2... d5 { [%eval 0.17] [%clk 1:59:20] } 1/2-1/2`;

describe("parseBroadcastGames", () => {
  it("parses a Lichess broadcast game", () => {
    const games = parseBroadcastGames(LICHESS_PGN);
    expect(games).toHaveLength(1);

    const g = games[0];
    expect(g.white).toBe("Esipenko, Andrey");
    expect(g.black).toBe("Nakamura, Hikaru");
    expect(g.whiteElo).toBe(2698);
    expect(g.blackElo).toBe(2810);
    expect(g.whiteFideId).toBe("24175439");
    expect(g.blackFideId).toBe("2016192");
    expect(g.whiteTitle).toBe("GM");
    expect(g.blackTitle).toBe("GM");
    expect(g.result).toBe("1/2-1/2");
    expect(g.eco).toBe("A13");
    expect(g.event).toBe("FIDE Candidates Tournament 2026");
    expect(g.round).toBe("2.4");
    expect(g.timeControl).toBe("120+30");
    expect(g.utcDate).toBe("2026.03.02");
    expect(g.utcTime).toBe("17:15:59");
    expect(g.broadcastName).toBe("FIDE Candidates 2026: Open");
    expect(g.broadcastUrl).toContain("FRTlzP2X");
    expect(g.gameUrl).toContain("q1PvC2Uo");
  });

  it("computes sourceKey from GameURL", () => {
    const games = parseBroadcastGames(LICHESS_PGN);
    expect(games[0].sourceKey).toBe("q1PvC2Uo");
  });

  it("computes fingerprint", () => {
    const games = parseBroadcastGames(LICHESS_PGN);
    expect(games[0].fingerprint).toHaveLength(64);
    expect(games[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computes normalized moves (stripped of clocks/evals)", () => {
    const games = parseBroadcastGames(LICHESS_PGN);
    expect(games[0].normalizedMoves).toBe("c4 e6 g3 d5");
  });

  it("computes move count", () => {
    const games = parseBroadcastGames(LICHESS_PGN);
    expect(games[0].moveCount).toBe(4);
  });

  it("extracts roundId from BroadcastURL", () => {
    const games = parseBroadcastGames(LICHESS_PGN);
    expect(games[0].roundId).toBe("FRTlzP2X");
  });

  it("rejects games where both players lack FIDE IDs", () => {
    const pgn = `[Event "Test"]
[White "Player A"]
[Black "Player B"]
[Result "1-0"]
[WhiteElo "2500"]
[BlackElo "2500"]

1. e4 e5 1-0`;
    const games = parseBroadcastGames(pgn);
    expect(games).toHaveLength(0);
  });

  it("accepts games where only one player has a FIDE ID", () => {
    const pgn = `[Event "Test"]
[White "Player A"]
[Black "Player B"]
[Result "1-0"]
[WhiteElo "2500"]
[BlackElo "2500"]
[WhiteFideId "1503014"]

1. e4 e5 1-0`;
    const games = parseBroadcastGames(pgn);
    expect(games).toHaveLength(1);
    expect(games[0].whiteFideId).toBe("1503014");
    expect(games[0].blackFideId).toBeNull();
  });

  it("accepts games with result '*' (in-progress broadcast games)", () => {
    const pgn = `[Event "Test"]
[White "Player A"]
[Black "Player B"]
[Result "*"]
[WhiteElo "2500"]
[BlackElo "2500"]
[WhiteFideId "1503014"]
[BlackFideId "2020009"]

1. e4 e5 *`;
    const games = parseBroadcastGames(pgn);
    // Broadcast games with * result ARE accepted (unlike TWIC which rejects them)
    expect(games).toHaveLength(1);
    expect(games[0].result).toBe("*");
  });
});

// ─── Cross-source fingerprint matching ──────────────────────────────────────

describe("cross-source dedup", () => {
  it("TWIC and Lichess PGN of the same game produce the same fingerprint", () => {
    // TWIC-style PGN (clean SAN, no annotations)
    const twicPgn = `[Event "FIDE Candidates 2026"]
[Date "2026.03.02"]
[White "Esipenko, Andrey"]
[Black "Nakamura, Hikaru"]
[Result "1/2-1/2"]
[WhiteElo "2698"]
[BlackElo "2810"]
[WhiteFideId "24175439"]
[BlackFideId "2016192"]
[ECO "A13"]

1. c4 e6 2. g3 d5 1/2-1/2`;

    // Lichess-style PGN (with clocks and evals)
    const lichessPgn = `[Event "FIDE Candidates Tournament 2026"]
[Date "2026.03.02"]
[White "Esipenko, Andrey"]
[Black "Nakamura, Hikaru"]
[Result "1/2-1/2"]
[WhiteElo "2698"]
[BlackElo "2810"]
[WhiteFideId "24175439"]
[BlackFideId "2016192"]
[ECO "A13"]
[UTCDate "2026.03.02"]
[UTCTime "17:15:59"]
[GameURL "https://lichess.org/broadcast/fide-candidates-2026-open/round-2/FRTlzP2X/q1PvC2Uo"]

1. c4 { [%eval 0.12] [%clk 1:59:51] } 1... e6 { [%eval 0.25] [%clk 1:59:49] } 2. g3 { [%eval 0.14] [%clk 1:59:40] } 2... d5 { [%eval 0.17] [%clk 1:59:20] } 1/2-1/2`;

    const twicGames = parseBroadcastGames(twicPgn);
    const lichessGames = parseBroadcastGames(lichessPgn);

    expect(twicGames).toHaveLength(1);
    expect(lichessGames).toHaveLength(1);

    // Same FIDE IDs, same date, same moves → same fingerprint
    expect(twicGames[0].fingerprint).toBe(lichessGames[0].fingerprint);
  });

  it("different games on the same day by the same players have different fingerprints", () => {
    const game1Pgn = `[Event "Test"]
[Date "2026.03.02"]
[White "A"]
[Black "B"]
[Result "1-0"]
[WhiteFideId "111"]
[BlackFideId "222"]

1. e4 e5 2. Nf3 Nc6 1-0`;

    const game2Pgn = `[Event "Test"]
[Date "2026.03.02"]
[White "A"]
[Black "B"]
[Result "0-1"]
[WhiteFideId "111"]
[BlackFideId "222"]

1. d4 d5 2. c4 e6 0-1`;

    const games1 = parseBroadcastGames(game1Pgn);
    const games2 = parseBroadcastGames(game2Pgn);

    expect(games1[0].fingerprint).not.toBe(games2[0].fingerprint);
  });
});

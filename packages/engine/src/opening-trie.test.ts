import { describe, it, expect, vi } from "vitest";
import { Chess } from "chess.js";
import { buildOpeningTrie, lookupTrie, sampleTrieMove } from "./opening-trie";
import type { GameRecord, TrieNode } from "./types";
import { DEFAULT_CONFIG } from "./config";

/* ── Helper: derive the normalized FEN at a given ply ────────── */

function fenAtPly(moves: string, ply: number): string {
  const chess = new Chess();
  const tokens = moves.split(" ");
  for (let i = 0; i < ply && i < tokens.length; i++) {
    chess.move(tokens[i]);
  }
  const parts = chess.fen().split(" ");
  return parts.slice(0, 4).join(" ");
}

/* ── Test data ───────────────────────────────────────────────── */

const RUY_LOPEZ = "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O";
const ITALIAN = "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Nc3 Nxe4";
const SICILIAN = "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be2 e5 Nb3 Be7";

function makeRecord(
  moves: string,
  playerColor: "white" | "black",
  result: "white" | "black" | "draw" = "draw",
): GameRecord {
  return { moves, playerColor, result };
}

/* ── buildOpeningTrie ────────────────────────────────────────── */

describe("buildOpeningTrie", () => {
  it("builds correct trie from game records", () => {
    const games = [
      makeRecord(RUY_LOPEZ, "white"),
      makeRecord(RUY_LOPEZ, "white"),
      makeRecord(ITALIAN, "white"),
    ];

    const trie = buildOpeningTrie(games, "white");

    // Starting position: all 3 games have white playing e4
    const startFen = fenAtPly("", 0);
    expect(trie[startFen]).toBeDefined();
    expect(trie[startFen].moves.length).toBe(1); // only e4
    expect(trie[startFen].moves[0].san).toBe("e4");
    expect(trie[startFen].moves[0].count).toBe(3);

    // After 1.e4 e5, white plays Nf3 in all 3 games
    const afterE4E5 = fenAtPly("e4 e5", 2);
    expect(trie[afterE4E5]).toBeDefined();
    expect(trie[afterE4E5].moves[0].san).toBe("Nf3");
    expect(trie[afterE4E5].moves[0].count).toBe(3);

    // After 1.e4 e5 2.Nf3 Nc6, white plays Bb5 (2 games) and Bc4 (1 game)
    const afterNf3Nc6 = fenAtPly("e4 e5 Nf3 Nc6", 4);
    expect(trie[afterNf3Nc6]).toBeDefined();
    expect(trie[afterNf3Nc6].moves.length).toBe(2);
    // Sorted by count descending
    expect(trie[afterNf3Nc6].moves[0].san).toBe("Bb5");
    expect(trie[afterNf3Nc6].moves[0].count).toBe(2);
    expect(trie[afterNf3Nc6].moves[1].san).toBe("Bc4");
    expect(trie[afterNf3Nc6].moves[1].count).toBe(1);
  });

  it("respects maxPly limit", () => {
    const games = [makeRecord(RUY_LOPEZ, "white")];
    const trie = buildOpeningTrie(games, "white", {
      ...DEFAULT_CONFIG,
      trie: { ...DEFAULT_CONFIG.trie, maxPly: 4 },
    });

    // Ply 0 and 2 should be recorded (white's moves at ply 0 and 2)
    const startFen = fenAtPly("", 0);
    const afterE4E5 = fenAtPly("e4 e5", 2);
    expect(trie[startFen]).toBeDefined();
    expect(trie[afterE4E5]).toBeDefined();

    // Ply 4 should NOT be recorded (maxPly=4 means plies 0..3 only)
    const afterNf3Nc6 = fenAtPly("e4 e5 Nf3 Nc6", 4);
    expect(trie[afterNf3Nc6]).toBeUndefined();
  });

  it("filters by color correctly", () => {
    const games = [
      makeRecord(RUY_LOPEZ, "white"),
      makeRecord(SICILIAN, "black"),
    ];

    const whiteTrie = buildOpeningTrie(games, "white");
    const blackTrie = buildOpeningTrie(games, "black");

    // White trie should have the starting position (white plays e4)
    const startFen = fenAtPly("", 0);
    expect(whiteTrie[startFen]).toBeDefined();
    expect(whiteTrie[startFen].moves[0].san).toBe("e4");

    // Black trie should NOT have the starting position (black doesn't move first)
    expect(blackTrie[startFen]).toBeUndefined();

    // Black trie should have the position after 1.e4 (black plays c5)
    const afterE4 = fenAtPly("e4", 1);
    expect(blackTrie[afterE4]).toBeDefined();
    expect(blackTrie[afterE4].moves[0].san).toBe("c5");
  });

  it("includes deep positions with minGames=1 (regression)", () => {
    // A single game with 16 moves (8 per side)
    const games = [makeRecord(RUY_LOPEZ, "white")];
    const trie = buildOpeningTrie(games, "white", {
      ...DEFAULT_CONFIG,
      trie: { ...DEFAULT_CONFIG.trie, minGames: 1 },
    });

    // White's move at ply 14 (move 8: c3) should be in the trie
    const fenPly14 = fenAtPly(RUY_LOPEZ, 14);
    expect(trie[fenPly14]).toBeDefined();
    expect(trie[fenPly14].moves[0].san).toBe("c3");
    expect(trie[fenPly14].moves[0].count).toBe(1);
  });

  it("default config now uses minGames=1", () => {
    expect(DEFAULT_CONFIG.trie.minGames).toBe(1);
  });

  it("records win rate correctly", () => {
    const games = [
      makeRecord(RUY_LOPEZ, "white", "white"), // win
      makeRecord(RUY_LOPEZ, "white", "black"), // loss
      makeRecord(RUY_LOPEZ, "white", "draw"),  // draw
    ];

    const trie = buildOpeningTrie(games, "white");
    const startFen = fenAtPly("", 0);
    const e4Move = trie[startFen].moves[0];

    expect(e4Move.count).toBe(3);
    // winRate = wins / count = 1/3
    expect(e4Move.winRate).toBeCloseTo(1 / 3, 5);
  });

  it("handles empty game list", () => {
    const trie = buildOpeningTrie([], "white");
    expect(Object.keys(trie).length).toBe(0);
  });

  it("handles games with no moves", () => {
    const games = [
      makeRecord("", "white"),
      { moves: "", playerColor: "white" as const },
    ];
    const trie = buildOpeningTrie(games, "white");
    expect(Object.keys(trie).length).toBe(0);
  });
});

/* ── lookupTrie ──────────────────────────────────────────────── */

describe("lookupTrie", () => {
  const games = [
    makeRecord(RUY_LOPEZ, "white"),
    makeRecord(RUY_LOPEZ, "white"),
  ];
  const trie = buildOpeningTrie(games, "white");

  it("returns node for known position", () => {
    const startFen = fenAtPly("", 0);
    // Use a full FEN (with halfmove/fullmove clocks) to test normalization
    const fullFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const node = lookupTrie(trie, fullFen);
    expect(node).not.toBeNull();
    expect(node!.moves[0].san).toBe("e4");
  });

  it("returns null for unknown position", () => {
    // A position that never appears in the Ruy Lopez
    const weirdFen = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1";
    const node = lookupTrie(trie, weirdFen);
    expect(node).toBeNull();
  });

  it("normalizes FEN: ignores halfmove and fullmove clocks", () => {
    const games = [makeRecord("e4 e5 Nf3", "white")];
    const trie = buildOpeningTrie(games, "white");

    // Position after 1.e4 — the actual FEN has "0 1" clocks
    // Test with different clock values
    const fenWithClocks1 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    const fenWithClocks2 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 5 10";

    // Both should be in the BLACK trie (it's black's turn), not white's.
    // But we built a white trie, so let's check the starting position instead.
    const startFenA = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const startFenB = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 99 50";

    const nodeA = lookupTrie(trie, startFenA);
    const nodeB = lookupTrie(trie, startFenB);

    expect(nodeA).not.toBeNull();
    expect(nodeB).not.toBeNull();
    expect(nodeA!.moves[0].san).toBe(nodeB!.moves[0].san);
  });
});

/* ── sampleTrieMove ──────────────────────────────────────────── */

describe("sampleTrieMove", () => {
  it("returns a move from the node", () => {
    const node: TrieNode = {
      moves: [
        { uci: "e2e4", san: "e4", count: 10, winRate: 0.5 },
        { uci: "d2d4", san: "d4", count: 5, winRate: 0.5 },
      ],
      totalGames: 15,
    };

    const move = sampleTrieMove(node);
    expect(move).not.toBeNull();
    expect(["e2e4", "d2d4"]).toContain(move!.uci);
  });

  it("returns null for empty node", () => {
    const node: TrieNode = { moves: [], totalGames: 0 };
    expect(sampleTrieMove(node)).toBeNull();
  });

  it("with winBias=0 samples proportional to count", () => {
    const node: TrieNode = {
      moves: [
        { uci: "e2e4", san: "e4", count: 9, winRate: 0.0 },
        { uci: "d2d4", san: "d4", count: 1, winRate: 1.0 },
      ],
      totalGames: 10,
    };

    // Mock Math.random to test deterministic behavior
    // rand=0.0 → should pick e4 (weight 9)
    // rand=0.89 → should pick e4 (cumulative 9/10 = 0.9)
    // rand=0.95 → should pick d4 (past cumulative threshold)
    const spy = vi.spyOn(Math, "random");

    spy.mockReturnValue(0.0);
    expect(sampleTrieMove(node, 0)!.san).toBe("e4");

    spy.mockReturnValue(0.5);
    expect(sampleTrieMove(node, 0)!.san).toBe("e4");

    spy.mockReturnValue(0.95);
    expect(sampleTrieMove(node, 0)!.san).toBe("d4");

    spy.mockRestore();
  });

  it("winBias>0 favors high win-rate moves", () => {
    const node: TrieNode = {
      moves: [
        { uci: "e2e4", san: "e4", count: 10, winRate: 0.8 },
        { uci: "d2d4", san: "d4", count: 10, winRate: 0.2 },
      ],
      totalGames: 20,
    };

    // With winBias=1:
    // e4 weight = 10 * (1 + 1 * (0.8 - 0.5)) = 10 * 1.3 = 13
    // d4 weight = 10 * (1 + 1 * (0.2 - 0.5)) = 10 * 0.7 = 7
    // total = 20, e4 threshold = 13/20 = 0.65
    const spy = vi.spyOn(Math, "random");

    spy.mockReturnValue(0.6); // 0.6 * 20 = 12 < 13 → e4
    expect(sampleTrieMove(node, 1)!.san).toBe("e4");

    spy.mockReturnValue(0.7); // 0.7 * 20 = 14 > 13 → d4
    expect(sampleTrieMove(node, 1)!.san).toBe("d4");

    spy.mockRestore();
  });
});

/* ── Regression: full-depth trie walkthrough ─────────────────── */

describe("regression: trie depth coverage", () => {
  it("walks an entire game and every player position is in the trie", () => {
    const games = [makeRecord(RUY_LOPEZ, "white")];
    const trie = buildOpeningTrie(games, "white");

    const chess = new Chess();
    const tokens = RUY_LOPEZ.split(" ");

    for (let ply = 0; ply < tokens.length; ply++) {
      const isWhiteMove = ply % 2 === 0;

      if (isWhiteMove) {
        // Every white-to-move position should be in the trie
        const node = lookupTrie(trie, chess.fen());
        expect(node).not.toBeNull();
        expect(node!.moves.some((m) => m.san === tokens[ply])).toBe(true);
      }

      chess.move(tokens[ply]);
    }
  });

  it("with minGames=3, single-game positions are dropped", () => {
    const games = [makeRecord(RUY_LOPEZ, "white")];
    const trie = buildOpeningTrie(games, "white", {
      ...DEFAULT_CONFIG,
      trie: { ...DEFAULT_CONFIG.trie, minGames: 3 },
    });

    // Starting position has only 1 game → should be filtered out
    const startFen = fenAtPly("", 0);
    expect(trie[startFen]).toBeUndefined();
    expect(Object.keys(trie).length).toBe(0);
  });
});

/* ── Regression: e4 e5 for black (Alireza scenario) ──────────── */

describe("regression: black trie includes e5 after 1.e4", () => {
  it("black trie has e5 after 1.e4 when player plays black", () => {
    const games = [
      makeRecord(RUY_LOPEZ, "black"),     // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 ...
      makeRecord(ITALIAN, "black"),        // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 ...
    ];

    const trie = buildOpeningTrie(games, "black");

    // After 1.e4 (black to move), trie should have e5
    const afterE4 = fenAtPly("e4", 1);
    expect(trie[afterE4]).toBeDefined();
    expect(trie[afterE4].moves[0].san).toBe("e5");
    expect(trie[afterE4].moves[0].count).toBe(2);
  });

  it("black trie has Nc6 after 1.e4 e5 2.Nf3", () => {
    const games = [
      makeRecord(RUY_LOPEZ, "black"),
      makeRecord(ITALIAN, "black"),
    ];

    const trie = buildOpeningTrie(games, "black");

    // After 1.e4 e5 2.Nf3 (black to move), trie should have Nc6
    const afterNf3 = fenAtPly("e4 e5 Nf3", 3);
    expect(trie[afterNf3]).toBeDefined();
    expect(trie[afterNf3].moves[0].san).toBe("Nc6");
  });

  it("starting position is NOT in black trie (white moves first)", () => {
    const games = [makeRecord(RUY_LOPEZ, "black")];
    const trie = buildOpeningTrie(games, "black");

    const startFen = fenAtPly("", 0);
    expect(trie[startFen]).toBeUndefined();
  });

  it("white trie has e4 at starting position, not e5", () => {
    const games = [
      makeRecord(RUY_LOPEZ, "white"),
      makeRecord(SICILIAN, "white"),
    ];

    const trie = buildOpeningTrie(games, "white");

    const startFen = fenAtPly("", 0);
    expect(trie[startFen]).toBeDefined();
    expect(trie[startFen].moves[0].san).toBe("e4");
  });
});

/* ── Regression: filtered game subsets ───────────────────────── */

describe("regression: filtered game subsets produce correctly scoped tries", () => {
  it("filtered game subset produces smaller trie", () => {
    const ruyGames = [
      makeRecord(RUY_LOPEZ, "white"),
      makeRecord(RUY_LOPEZ, "white"),
      makeRecord(RUY_LOPEZ, "white"),
    ];
    const sicilianGames = [
      makeRecord(SICILIAN, "white"),
      makeRecord(SICILIAN, "white"),
    ];

    const fullTrie = buildOpeningTrie([...ruyGames, ...sicilianGames], "white");
    const ruyOnlyTrie = buildOpeningTrie(ruyGames, "white");

    // Full trie has both Bb5 (Ruy) and d4 (Sicilian) at respective positions
    const afterNf3Nc6 = fenAtPly("e4 e5 Nf3 Nc6", 4);
    expect(fullTrie[afterNf3Nc6]).toBeDefined();
    expect(fullTrie[afterNf3Nc6].moves.some((m) => m.san === "Bb5")).toBe(true);

    // Sicilian: position after 1.e4 c5 2.Nf3 d6 — white plays d4
    const afterNf3D6 = fenAtPly("e4 c5 Nf3 d6", 4);
    expect(fullTrie[afterNf3D6]).toBeDefined();

    // Ruy-only trie should NOT have the Sicilian position
    expect(ruyOnlyTrie[afterNf3D6]).toBeUndefined();

    // But should still have the Ruy position
    expect(ruyOnlyTrie[afterNf3Nc6]).toBeDefined();
    expect(ruyOnlyTrie[afterNf3Nc6].moves[0].san).toBe("Bb5");
  });

  it("trie from one game excludes positions only in the other game", () => {
    const gameA = makeRecord(RUY_LOPEZ, "white");  // 1.e4 e5 2.Nf3 Nc6 3.Bb5 ...
    const gameB = makeRecord(ITALIAN, "white");     // 1.e4 e5 2.Nf3 Nc6 3.Bc4 ...

    const trieA = buildOpeningTrie([gameA], "white");
    const trieB = buildOpeningTrie([gameB], "white");
    const trieBoth = buildOpeningTrie([gameA, gameB], "white");

    const afterNf3Nc6 = fenAtPly("e4 e5 Nf3 Nc6", 4);

    // Combined trie has both Bb5 and Bc4
    expect(trieBoth[afterNf3Nc6].moves.length).toBe(2);

    // Individual tries only have their respective move
    expect(trieA[afterNf3Nc6].moves.length).toBe(1);
    expect(trieA[afterNf3Nc6].moves[0].san).toBe("Bb5");

    expect(trieB[afterNf3Nc6].moves.length).toBe(1);
    expect(trieB[afterNf3Nc6].moves[0].san).toBe("Bc4");

    // Deep positions unique to game A absent from trie B and vice versa
    // After 3.Bb5 a6 (Ruy Lopez continuation)
    const afterBb5A6 = fenAtPly("e4 e5 Nf3 Nc6 Bb5 a6", 6);
    expect(trieA[afterBb5A6]).toBeDefined();
    expect(trieB[afterBb5A6]).toBeUndefined();

    // After 3.Bc4 Bc5 (Italian continuation)
    const afterBc4Bc5 = fenAtPly("e4 e5 Nf3 Nc6 Bc4 Bc5", 6);
    expect(trieB[afterBc4Bc5]).toBeDefined();
    expect(trieA[afterBc4Bc5]).toBeUndefined();
  });

  it("trie from subset covers that subset's positions identically", () => {
    const gameA = makeRecord(RUY_LOPEZ, "white");
    const gameB = makeRecord(SICILIAN, "white");

    const trieSubset = buildOpeningTrie([gameA], "white");
    const trieFull = buildOpeningTrie([gameA, gameB], "white");

    // Walk game A's moves — every white position should be in both tries
    const chess = new Chess();
    const tokens = RUY_LOPEZ.split(" ");

    for (let ply = 0; ply < tokens.length; ply++) {
      if (ply % 2 === 0) {
        const subsetNode = lookupTrie(trieSubset, chess.fen());
        const fullNode = lookupTrie(trieFull, chess.fen());

        // Both should have this position
        expect(subsetNode).not.toBeNull();
        expect(fullNode).not.toBeNull();

        // The subset trie should have the same move available
        const moveInSubset = subsetNode!.moves.find((m) => m.san === tokens[ply]);
        const moveInFull = fullNode!.moves.find((m) => m.san === tokens[ply]);
        expect(moveInSubset).toBeDefined();
        expect(moveInFull).toBeDefined();

        // Count in subset should equal count in full for this specific game's line
        // (game A appears once in both, so count should be 1 in subset)
        expect(moveInSubset!.count).toBe(1);
      }
      chess.move(tokens[ply]);
    }
  });
});

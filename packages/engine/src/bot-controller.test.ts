import { describe, expect, it, vi } from "vitest";
import { Chess } from "chess.js";
import { BotController } from "./bot-controller";
import type { ChessEngine, MovePolicy, OpeningTrie } from "./types";

function engine(): ChessEngine {
  return {
    evaluateMultiPV: vi.fn(async () => [
      { uci: "g1f3", score: 20, depth: 10, pv: "g1f3" },
    ]),
    evaluate: vi.fn(async () => ({
      uci: "g1f3", score: 20, depth: 10, pv: "g1f3",
    })),
    dispose: vi.fn(),
  };
}

function policy(selectMove: MovePolicy["selectMove"]): MovePolicy {
  return { id: "maia", selectMove };
}

const initialFen = new Chess().fen().split(" ").slice(0, 4).join(" ");

describe("BotController move policy ordering", () => {
  it("uses the personal opening trie before Maia", async () => {
    const movePolicy = policy(vi.fn(async () => ({ uci: "d2d4" })));
    const openingTrie: OpeningTrie = {
      [initialFen]: {
        totalGames: 3,
        moves: [{ uci: "e2e4", san: "e4", count: 3, winRate: 0.5 }],
      },
    };
    const bot = new BotController({
      engine: engine(), elo: 1500, errorProfile: null, openingTrie,
      botColor: "white", movePolicy,
    });

    const result = await bot.getMove(new Chess().fen());

    expect(result.source).toBe("book");
    expect(result.uci).toBe("e2e4");
    expect(movePolicy.selectMove).not.toHaveBeenCalled();
  });

  it("uses Maia out of book without fabricating engine candidates", async () => {
    const chessEngine = engine();
    const bot = new BotController({
      engine: chessEngine, elo: 1500, errorProfile: null, openingTrie: null,
      botColor: "white",
      movePolicy: policy(async () => ({
        uci: "d2d4",
        candidates: [{ uci: "d2d4", probability: 0.6 }],
      })),
    });

    const result = await bot.getMove(new Chess().fen());

    expect(result.source).toBe("maia");
    expect(result.candidates).toBeUndefined();
    expect(result.policyCandidates?.[0].probability).toBe(0.6);
    expect(chessEngine.evaluateMultiPV).not.toHaveBeenCalled();
  });

  it("discloses Stockfish fallback when Maia fails", async () => {
    const onPolicyFailure = vi.fn();
    const bot = new BotController({
      engine: engine(), elo: 1500, errorProfile: null, openingTrie: null,
      botColor: "white",
      movePolicy: policy(async () => { throw new Error("model unavailable"); }),
      onPolicyFailure,
    });

    const result = await bot.getMove(new Chess().fen());

    expect(result.source).toBe("engine");
    expect(result.fallbackReason).toContain("model unavailable");
    expect(onPolicyFailure).toHaveBeenCalledOnce();
  });
});

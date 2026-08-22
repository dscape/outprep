import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import {
  maiaMoveIndex,
  mirrorMove,
  preprocessMaiaPosition,
  probabilitiesForLegalMoves,
  sampleMaiaMove,
} from "./maia-tensor";

describe("Maia-3 preprocessing", () => {
  it("uses the documented 4096 base moves and 256 promotion moves", () => {
    expect(maiaMoveIndex("a1a1")).toBe(0);
    expect(maiaMoveIndex("h8h8")).toBe(4095);
    expect(maiaMoveIndex("a7a8q")).toBe(4096);
    expect(maiaMoveIndex("h7h8n")).toBe(4351);
  });

  it("mirrors black-to-move positions and maps back to legal UCI moves", () => {
    const chess = new Chess();
    chess.move("e4");
    const input = preprocessMaiaPosition(chess.fen());

    expect(input.legalMoves).toHaveLength(chess.moves().length);
    expect(input.legalMoves.map((move) => move.uci)).toContain("e7e5");
    expect(input.legalMoves.find((move) => move.uci === "e7e5")?.index)
      .toBe(maiaMoveIndex(mirrorMove("e7e5")));
    expect(input.tokens.reduce((sum, value) => sum + value, 0)).toBe(32);
  });

  it("masks illegal logits before softmax and samples only legal moves", () => {
    const legalMoves = [
      { uci: "e2e4", index: maiaMoveIndex("e2e4") },
      { uci: "d2d4", index: maiaMoveIndex("d2d4") },
    ];
    const logits = new Float32Array(4352);
    logits[maiaMoveIndex("a1a8")] = 1000;
    logits[maiaMoveIndex("e2e4")] = 2;
    logits[maiaMoveIndex("d2d4")] = 1;

    const probabilities = probabilitiesForLegalMoves(logits, legalMoves);

    expect(probabilities.map((move) => move.uci)).toEqual(["e2e4", "d2d4"]);
    expect(probabilities.reduce((sum, move) => sum + move.probability, 0)).toBeCloseTo(1);
    expect(sampleMaiaMove(probabilities, () => 0).uci).toBe("e2e4");
    expect(sampleMaiaMove(probabilities, () => 0.999).uci).toBe("d2d4");
  });
});

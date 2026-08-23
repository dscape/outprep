import { describe, expect, it } from "vitest";
import {
  getOpeningFamilyLine,
  getOpeningFamilyMoves,
} from "./eco-classifier";
import { getOpeningMoves } from "./eco-lookup";

describe("opening practice lines", () => {
  it("uses only the family-defining French moves for a Classical ECO", async () => {
    expect(getOpeningFamilyMoves("French Defense: Classical Variation"))
      .toEqual(["e4", "e6"]);
    expect(getOpeningFamilyLine("French Defense"))
      .toBe("1.e4 e6");
    await expect(getOpeningMoves("C14", "French Defense"))
      .resolves.toEqual(["e2e4", "e7e6"]);
  });

  it("prefers the exact family entry over an equally short variation", () => {
    expect(getOpeningFamilyMoves("Queen's Gambit Declined"))
      .toEqual(["d4", "d5", "c4", "e6"]);
  });

  it("does not prefer a longer generic entry over a shorter family line", () => {
    expect(getOpeningFamilyMoves("Semi-Slav Defense"))
      .toEqual(["d4", "d5", "c4", "e6", "Nc3", "c6"]);
  });

  it("keeps only the minimum generic line for another deep family", async () => {
    expect(getOpeningFamilyMoves("King's Indian Defense: Classical Variation"))
      .toEqual(["d4", "Nf6", "c4", "g6", "Nc3"]);
    await expect(getOpeningMoves("E98", "King's Indian Defense"))
      .resolves.toEqual(["d2d4", "g8f6", "c2c4", "g7g6", "b1c3"]);
  });

  it("falls back to the ECO line for old links without a family name", async () => {
    const moves = await getOpeningMoves("B20");
    expect(moves).toEqual(["e2e4", "c7c5"]);
  });

  it("returns no starting moves for an unknown opening", async () => {
    expect(getOpeningFamilyMoves("Imaginary Defense")).toEqual([]);
    await expect(getOpeningMoves("Z99", "Imaginary Defense"))
      .resolves.toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  fideToMaiaRating,
  lichessToFide,
  maiaRatingToEstimatedFide,
  resolveMaiaRating,
} from "../fide-estimator";

describe("Maia rating calibration", () => {
  it("approximately inverts the existing Lichess-to-FIDE table", () => {
    for (const lichess of [600, 800, 1200, 1500, 2000, 2500]) {
      expect(fideToMaiaRating(lichessToFide(lichess))).toBeCloseTo(lichess, -1);
    }
  });

  it("prefers an actual Lichess blitz rating", () => {
    expect(resolveMaiaRating({
      platform: "lichess",
      blitzRating: 1217,
      fideEstimate: 1429,
    })).toBe(1217);
  });

  it("converts FIDE and Chess.com estimates to the model scale", () => {
    expect(resolveMaiaRating({ platform: "fide", fideEstimate: 1420 })).toBe(1200);
    expect(resolveMaiaRating({ platform: "chesscom", fideEstimate: 1420 })).toBe(1200);
  });

  it("presents the model input as an estimated FIDE calibration", () => {
    expect(maiaRatingToEstimatedFide(1217)).toBe(1429);
    expect(maiaRatingToEstimatedFide(2500)).toBe(2400);
    expect(maiaRatingToEstimatedFide(Number.NaN)).toBe(1575);
  });
});

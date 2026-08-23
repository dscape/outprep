import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupOpening } from "./opening-lookup";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupOpening", () => {
  it("classifies a Scotch Game from PGN without a network request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const pgn = `
[Event "Practice"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. d4 f5 4. exf5 Nd4 5. Nxe5 Bc5 *
`;

    expect(lookupOpening(pgn)).toBe("Scotch Game");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the selected opening as a fallback for unclassified PGN", () => {
    expect(lookupOpening("invalid PGN", "Scotch Game")).toBe("Scotch Game");
  });

  it("returns Unknown Opening when no moves or fallback are available", () => {
    expect(lookupOpening("")).toBe("Unknown Opening");
  });
});

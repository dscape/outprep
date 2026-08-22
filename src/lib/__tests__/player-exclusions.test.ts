import { describe, expect, it } from "vitest";
import {
  EXCLUDED_FIDE_IDS,
  fideIdFromSlug,
  hasExcludedFideId,
  isExcludedFideId,
  isExcludedFideSlug,
  slugContainsExcludedFideId,
} from "../player-exclusions";

describe("player exclusions", () => {
  it("contains the requested FIDE ID", () => {
    expect(EXCLUDED_FIDE_IDS).toContain("2225972");
    expect(isExcludedFideId("2225972")).toBe(true);
  });

  it("recognizes canonical slugs without matching unrelated numbers", () => {
    expect(fideIdFromSlug("jose-luis-segura-ariza-2225972")).toBe("2225972");
    expect(isExcludedFideSlug("jose-luis-segura-ariza-2225972")).toBe(true);
    expect(isExcludedFideSlug("some-player-22259720")).toBe(false);
  });

  it("recognizes games and nested game slugs containing an excluded ID", () => {
    expect(hasExcludedFideId("1", "2225972")).toBe(true);
    expect(slugContainsExcludedFideId("event-2024/player-1-vs-segura-2225972")).toBe(true);
    expect(slugContainsExcludedFideId("event-2024/player-1-vs-other-22259720")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { buildPracticeUrl } from "./practice-url";

describe("buildPracticeUrl", () => {
  it("builds a platform-aware opening practice URL", () => {
    const value = buildPracticeUrl("pgn", "Test Bot", {
      selectedSpeeds: ["classical"],
      availableSpeeds: ["classical"],
      timeRange: "all",
      gameCount: 12,
      opening: {
        eco: "C14",
        name: "French Defense",
        profiledPlayerColor: "black",
      },
    });
    const url = new URL(value, "http://localhost");

    expect(url.pathname).toBe("/play/pgn:Test%20Bot");
    expect(url.searchParams.get("speeds")).toBeNull();
    expect(url.searchParams.get("gameCount")).toBe("12");
    expect(url.searchParams.get("eco")).toBe("C14");
    expect(url.searchParams.get("openingName")).toBe("French Defense");
    expect(url.searchParams.get("color")).toBe("black");
  });

  it("preserves active speed and time filters", () => {
    const now = Date.UTC(2026, 7, 23);
    const value = buildPracticeUrl("lichess", "player", {
      selectedSpeeds: ["blitz"],
      availableSpeeds: ["blitz", "rapid"],
      timeRange: "3m",
      now,
    });
    const url = new URL(value, "http://localhost");

    expect(url.pathname).toBe("/play/player");
    expect(url.searchParams.get("speeds")).toBe("blitz");
    expect(Number(url.searchParams.get("since"))).toBeLessThan(now);
    expect(url.searchParams.get("timeRangeLabel")).toBe("3 months");
  });
});

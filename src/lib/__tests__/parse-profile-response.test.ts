import { describe, it, expect } from "vitest";
import { parsePlayProfile } from "@/lib/parse-profile-response";

describe("parsePlayProfile", () => {
  const fallback = "testuser";

  it("parses standard JSON response (in-memory cache hit)", () => {
    const json = JSON.stringify({
      username: "Leon_Sihan_Li",
      fideEstimate: { rating: 1901, confidence: 72 },
      analyzedGames: 150,
    });

    const result = parsePlayProfile(json, fallback);
    expect(result.username).toBe("Leon_Sihan_Li");
    expect(result.fideEstimate.rating).toBe(1901);
  });

  it("parses NDJSON with openings + profile lines", () => {
    const lines = [
      JSON.stringify({
        type: "openings",
        openings: [],
        ratings: {},
        username: "Leon_Sihan_Li",
        gameCount: 200,
        fideEstimate: { rating: 1901, confidence: 72 },
      }),
      JSON.stringify({
        type: "profile",
        profile: {
          username: "Leon_Sihan_Li",
          fideEstimate: { rating: 1901, confidence: 72 },
          analyzedGames: 200,
        },
      }),
    ].join("\n");

    const result = parsePlayProfile(lines, fallback);
    expect(result.username).toBe("Leon_Sihan_Li");
    expect(result.fideEstimate.rating).toBe(1901);
  });

  it("parses NDJSON with profile-only line (DB cache hit)", () => {
    const lines = JSON.stringify({
      type: "profile",
      profile: {
        username: "Leon_Sihan_Li",
        fideEstimate: { rating: 1901, confidence: 72 },
      },
    });

    const result = parsePlayProfile(lines, fallback);
    expect(result.username).toBe("Leon_Sihan_Li");
    expect(result.fideEstimate.rating).toBe(1901);
  });

  it("returns fallback for empty response", () => {
    const result = parsePlayProfile("", fallback);
    expect(result.username).toBe(fallback);
    expect(result.fideEstimate.rating).toBe(0);
  });

  it("returns fallback for whitespace-only response", () => {
    const result = parsePlayProfile("   \n  ", fallback);
    expect(result.username).toBe(fallback);
    expect(result.fideEstimate.rating).toBe(0);
  });

  it("returns fallback for invalid JSON/NDJSON", () => {
    const result = parsePlayProfile("not json at all", fallback);
    expect(result.username).toBe(fallback);
    expect(result.fideEstimate.rating).toBe(0);
  });

  it("handles NDJSON with error line gracefully", () => {
    const lines = [
      JSON.stringify({ type: "error", error: "Something went wrong" }),
    ].join("\n");

    const result = parsePlayProfile(lines, fallback);
    expect(result.username).toBe(fallback);
    expect(result.fideEstimate.rating).toBe(0);
  });

  it("extracts fideEstimate from openings line even without profile line", () => {
    const lines = JSON.stringify({
      type: "openings",
      username: "hikaru",
      fideEstimate: { rating: 2700, confidence: 95 },
      openings: [],
      ratings: {},
      gameCount: 5000,
    });

    const result = parsePlayProfile(lines, fallback);
    expect(result.username).toBe("hikaru");
    expect(result.fideEstimate.rating).toBe(2700);
  });

  it("prefers profile line data over openings line when both present", () => {
    const lines = [
      JSON.stringify({
        type: "openings",
        username: "user_early",
        fideEstimate: { rating: 1800, confidence: 60 },
      }),
      JSON.stringify({
        type: "profile",
        profile: {
          username: "user_final",
          fideEstimate: { rating: 1850, confidence: 75 },
        },
      }),
    ].join("\n");

    const result = parsePlayProfile(lines, fallback);
    // Profile line comes last and overwrites openings line
    expect(result.username).toBe("user_final");
    expect(result.fideEstimate.rating).toBe(1850);
  });
});

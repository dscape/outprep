/**
 * Integration test: downloads a real TWIC issue and validates the parse pipeline.
 *
 * Requires network access. Run alongside unit tests; vitest will skip this file
 * if network is unavailable (fetch will simply throw and the test will fail with
 * a clear error rather than a false negative).
 *
 * We use TWIC 1500 — a historical issue that will always exist and is small enough
 * to download quickly.
 */

import { describe, it, expect } from "vitest";
import { downloadAndExtractPgn } from "@/lib/pipeline/pgn-extract";
import { parseGames, generateGameSlug, generatePlayerSlug } from "@/lib/pipeline/twic-incremental";

const TWIC_ISSUE = 1500;

describe(`TWIC ${TWIC_ISSUE} download → parse pipeline`, () => {
  it(
    "downloads and extracts a non-empty PGN",
    { timeout: 30_000 },
    async () => {
      const pgn = await downloadAndExtractPgn(TWIC_ISSUE);
      expect(pgn).not.toBeNull();
      expect(pgn!.length).toBeGreaterThan(1000);
      expect(pgn).toContain("[Event ");
    },
  );

  it(
    "parses >0 games with valid fields",
    { timeout: 30_000 },
    async () => {
      const pgn = await downloadAndExtractPgn(TWIC_ISSUE);
      expect(pgn).not.toBeNull();

      const games = parseGames(pgn!);
      expect(games.length).toBeGreaterThan(0);

      for (const g of games) {
        expect(g.white).toBeTruthy();
        expect(g.black).toBeTruthy();
        expect(["1-0", "0-1", "1/2-1/2"]).toContain(g.result);
        expect(g.whiteElo !== null || g.blackElo !== null).toBe(true);
      }
    },
  );

  it(
    "generates unique, non-empty game slugs",
    { timeout: 30_000 },
    async () => {
      const pgn = await downloadAndExtractPgn(TWIC_ISSUE);
      const games = parseGames(pgn!);

      const slugs = games.map((g) => generateGameSlug(g));
      const unique = new Set(slugs);

      expect(slugs.every((s) => s.length > 0)).toBe(true);
      // Allow a small number of duplicates (handled by collision logic in the pipeline)
      expect(unique.size).toBeGreaterThan(slugs.length * 0.95);
    },
  );

  it(
    "generates valid player slugs for games with FIDE IDs",
    { timeout: 30_000 },
    async () => {
      const pgn = await downloadAndExtractPgn(TWIC_ISSUE);
      const games = parseGames(pgn!);

      const gamesWithIds = games.filter(
        (g) => g.whiteFideId && g.blackFideId,
      );
      expect(gamesWithIds.length).toBeGreaterThan(0);

      for (const g of gamesWithIds) {
        const ws = generatePlayerSlug(g.white, g.whiteFideId!);
        const bs = generatePlayerSlug(g.black, g.blackFideId!);
        expect(ws).toMatch(/^[a-z0-9-]+$/);
        expect(bs).toMatch(/^[a-z0-9-]+$/);
      }
    },
  );
});

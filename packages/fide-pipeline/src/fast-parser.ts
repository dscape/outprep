/**
 * Fast header-only PGN parser.
 *
 * Reuses the splitPGN/extractHeaders pattern from src/lib/pgn-parser.ts
 * but skips chess.js move validation entirely. This is ~100x faster
 * and sufficient for SEO pages where we only need metadata.
 *
 * Raw PGN text is preserved verbatim for later lazy-validation when
 * a user clicks "Practice against [player]".
 */

import type { TWICGameHeader } from "./types";

/**
 * Split a multi-game PGN string into individual game strings.
 * Games are separated by double newlines followed by an [Event header.
 */
export function splitPGN(pgnText: string): string[] {
  const games: string[] = [];
  const parts = pgnText.split(/\n\n(?=\[Event )/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) games.push(trimmed);
  }
  return games.length > 0 ? games : [pgnText.trim()].filter(Boolean);
}

/**
 * Extract PGN headers from a single game PGN string.
 */
export function extractHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const regex = /\[(\w+)\s+"([^"]*)"\]/g;
  let match;
  while ((match = regex.exec(pgn)) !== null) {
    headers[match[1]] = match[2];
  }
  return headers;
}

/**
 * Parse a PGN string into game headers without move validation.
 * Skips games with no player names or with result "*" (unfinished).
 */
export function parseHeaders(pgnText: string): TWICGameHeader[] {
  const rawGames = splitPGN(pgnText);
  const results: TWICGameHeader[] = [];

  for (const rawPgn of rawGames) {
    const h = extractHeaders(rawPgn);

    const white = h["White"] || "";
    const black = h["Black"] || "";
    const result = h["Result"] || "*";

    // Skip games with missing players or unfinished results
    if (!white || !black || white === "?" || black === "?") continue;
    if (result === "*") continue;

    const whiteElo = parseElo(h["WhiteElo"]);
    const blackElo = parseElo(h["BlackElo"]);

    // Skip games where neither player has a rating
    if (whiteElo === null && blackElo === null) continue;

    results.push({
      white,
      black,
      whiteElo,
      blackElo,
      whiteTitle: parseTitle(h["WhiteTitle"]),
      blackTitle: parseTitle(h["BlackTitle"]),
      whiteFideId: parseFideId(h["WhiteFideId"]),
      blackFideId: parseFideId(h["BlackFideId"]),
      eco: h["ECO"] || null,
      event: h["Event"] || null,
      site: h["Site"] || null,
      date: h["Date"] || null,
      result,
      rawPgn,
    });
  }

  return results;
}

/** Parse an Elo string to number, returning null for missing/invalid. */
function parseElo(elo: string | undefined): number | null {
  if (!elo || elo === "-" || elo === "0" || elo === "") return null;
  const n = parseInt(elo, 10);
  return isNaN(n) || n < 100 ? null : n;
}

/** Parse a FIDE ID string, returning null for missing/invalid. */
function parseFideId(id: string | undefined): string | null {
  if (!id || id === "0" || id === "" || id === "-") return null;
  // FIDE IDs are numeric strings, typically 5-8 digits
  const trimmed = id.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

/** Parse a FIDE title, returning null for missing/unknown. */
function parseTitle(title: string | undefined): string | null {
  if (!title || title === "-" || title === "") return null;
  const valid = ["GM", "IM", "FM", "CM", "NM", "WGM", "WIM", "WFM", "WCM"];
  const upper = title.toUpperCase().trim();
  return valid.includes(upper) ? upper : null;
}

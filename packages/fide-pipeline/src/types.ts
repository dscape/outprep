/**
 * Types for the FIDE pipeline — TWIC data processing and Vercel Blob storage.
 */

/** Extracted from a single PGN game's header tags (no move parsing). */
export interface TWICGameHeader {
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  whiteTitle: string | null;
  blackTitle: string | null;
  whiteFideId: string | null; // FIDE ID for reliable player dedup
  blackFideId: string | null;
  eco: string | null;
  event: string | null;
  site: string | null;
  date: string | null;
  result: string; // "1-0" | "0-1" | "1/2-1/2" | "*"
  rawPgn: string; // Full PGN text for later practice use
}

/** Opening stats — matches the shape in src/lib/types.ts */
export interface OpeningStats {
  eco: string;
  name: string;
  games: number;
  pct: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
}

/** Aggregated player profile for a single FIDE player. */
export interface FIDEPlayer {
  name: string; // "Carlsen,M" or "Carlsen,Magnus"
  slug: string; // "m-carlsen-1503014" (firstname-lastname-fideId)
  fideId: string; // FIDE ID (e.g. "2020009") — required, players without are dropped
  aliases: string[]; // Alternative slugs that 301 redirect to this player's canonical slug
  fideRating: number; // Most recent Elo observed
  title: string | null; // "GM" | "IM" | "FM" | etc.
  gameCount: number;
  recentEvents: string[]; // Last 5 unique events
  lastSeen: string; // ISO date of most recent game (YYYY.MM.DD)
  openings: {
    white: OpeningStats[];
    black: OpeningStats[];
  };
  winRate: number; // 0-100
  drawRate: number;
  lossRate: number;
}

/** Compact player entry for the master index (sitemap + listing). */
export interface PlayerIndexEntry {
  slug: string;
  name: string;
  fideId: string;
  aliases: string[];
  fideRating: number;
  title: string | null;
  gameCount: number;
}

/** Master index stored in Vercel Blob. */
export interface PlayerIndex {
  generatedAt: string; // ISO timestamp
  totalPlayers: number;
  players: PlayerIndexEntry[];
}

/** Internal accumulator used during aggregation. */
export interface PlayerAccumulator {
  name: string; // Display name (best/longest form seen)
  nameVariants: Set<string>; // All name forms seen (e.g. "Caruana,F", "Caruana,Fabiano")
  normalizedKey: string; // Lowercase deduplication key
  fideId: string | null; // FIDE ID — primary dedup key when available
  latestElo: number;
  latestEloDate: string; // For tracking "most recent" rating
  title: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  events: Map<string, string>; // event name → latest date
  /** ECO counts as white: eco → { games, wins, draws, losses } */
  whiteEcos: Map<string, { eco: string; name: string; games: number; wins: number; draws: number; losses: number }>;
  /** ECO counts as black */
  blackEcos: Map<string, { eco: string; name: string; games: number; wins: number; draws: number; losses: number }>;
  rawPgns: string[]; // All raw PGN texts for practice
}

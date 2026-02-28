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
  opening: string | null; // From PGN [Opening] header (e.g. "Sicilian")
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
  name: string; // "Carlsen, Magnus" (FIDE full name after enrichment)
  slug: string; // "magnus-carlsen-1503014" (firstname-lastname-fideId)
  fideId: string; // FIDE ID (e.g. "2020009") — required, players without are dropped
  aliases: string[]; // Alternative slugs that 301 redirect to this player's canonical slug
  fideRating: number; // Most recent Elo observed in TWIC games
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
  // Official FIDE ratings (from FIDE rating list enrichment)
  federation?: string; // "USA", "NOR", etc.
  birthYear?: number; // e.g. 1992
  standardRating?: number; // Official FIDE Standard rating
  rapidRating?: number; // Official FIDE Rapid rating
  blitzRating?: number; // Official FIDE Blitz rating
  recentGames?: Array<{
    slug: string;
    opponentName: string;
    opponentElo: number;
    result: "Won" | "Lost" | "Draw";
    event: string;
    date: string;
    opening: string | null;
    isWhite: boolean;
  }>;
  notableGames?: Array<{
    slug: string;
    opponentName: string;
    opponentElo: number;
    result: "Won" | "Lost" | "Draw";
    event: string;
    date: string;
    opening: string | null;
    isWhite: boolean;
  }>;
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
  federation?: string;
  standardRating?: number;
  rapidRating?: number;
  blitzRating?: number;
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
  /** Opening family counts as white: familyName → { ecoMap, games, wins, draws, losses } */
  whiteOpenings: Map<string, { ecoMap: Map<string, number>; name: string; games: number; wins: number; draws: number; losses: number }>;
  /** Opening family counts as black */
  blackOpenings: Map<string, { ecoMap: Map<string, number>; name: string; games: number; wins: number; draws: number; losses: number }>;
}

// ─── Game types ──────────────────────────────────────────────────────────────

/** Individual game detail for SEO pages. Stored in Blob as individual JSON files. */
export interface GameDetail {
  slug: string;
  whiteName: string; // Enriched FIDE full name
  blackName: string;
  whiteSlug: string; // Links to /player/{slug}
  blackSlug: string;
  whiteFideId: string;
  blackFideId: string;
  whiteElo: number;
  blackElo: number;
  whiteTitle: string | null;
  blackTitle: string | null;
  whiteFederation: string | null;
  blackFederation: string | null;
  event: string;
  site: string | null;
  date: string; // "2022.04.20"
  round: string | null;
  eco: string | null;
  opening: string | null; // From PGN [Opening] header
  variation: string | null; // From PGN [Variation] header
  result: string; // "1-0" | "0-1" | "1/2-1/2"
  pgn: string; // Full raw PGN for replay/practice
}

/** Compact entry for the game index (sitemap + listing). No PGN. */
export interface GameIndexEntry {
  slug: string;
  whiteName: string;
  blackName: string;
  whiteSlug: string;
  blackSlug: string;
  whiteFideId: string;
  blackFideId: string;
  whiteElo: number;
  blackElo: number;
  whiteFederation: string | null;
  blackFederation: string | null;
  event: string;
  date: string;
  result: string;
  eco: string | null;
  opening: string | null;
}

/** Master game index stored in Vercel Blob. */
export interface GameIndex {
  generatedAt: string; // ISO timestamp
  totalGames: number;
  games: GameIndexEntry[];
}

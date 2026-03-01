import { OTBGame, LichessGame } from "./types";
import { openingFamily } from "./profile-builder";
import { classifyOpening } from "./analysis/eco-classifier";
import { generateGameSlug } from "./game-slug";
import { ECO_NAMES } from "../../packages/fide-pipeline/src/eco-names";

export interface GameForDrilldown {
  id: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  openingFamily: string;
  playerColor: "white" | "black";
  opponent: string;
  date?: string;
  event?: string;
}

/**
 * Convert OTB games (from PGN import) into GameForDrilldown[].
 */
export function otbGamesToDrilldown(
  games: OTBGame[],
  username: string
): GameForDrilldown[] {
  const lower = username.toLowerCase();

  return games.map((g, i) => {
    const isWhite = g.white.toLowerCase().includes(lower);
    const playerColor: "white" | "black" = isWhite ? "white" : "black";
    const opponent = isWhite ? g.black : g.white;

    // Determine opening family: PGN header → ECO classifier → fallback
    let rawOpening = g.opening || "";
    if (!rawOpening && g.eco) {
      rawOpening = g.eco;
    }
    if (!rawOpening) {
      const classified = classifyOpening(g.moves);
      rawOpening = classified?.name || "Unknown";
    }

    return {
      id: `otb-${i}`,
      pgn: g.pgn,
      white: g.white,
      black: g.black,
      result: g.result,
      openingFamily: openingFamily(rawOpening),
      playerColor,
      opponent,
      date: g.date,
      event: g.event,
    };
  });
}

/**
 * Convert Lichess games into GameForDrilldown[].
 */
export function lichessGamesToDrilldown(
  games: LichessGame[],
  username: string
): GameForDrilldown[] {
  const lowerUser = username.toLowerCase();

  return games.map((g) => {
    const whiteId = g.players.white.user?.id?.toLowerCase() || "";
    const blackId = g.players.black.user?.id?.toLowerCase() || "";
    const isWhite = whiteId === lowerUser;
    const playerColor: "white" | "black" = isWhite ? "white" : "black";

    const whiteName = g.players.white.user?.name || "White";
    const blackName = g.players.black.user?.name || "Black";
    const opponent = isWhite ? blackName : whiteName;

    const rawOpening = g.opening?.name || "Unknown";

    // Derive result from winner field
    let result = "1/2-1/2";
    if (g.winner === "white") result = "1-0";
    else if (g.winner === "black") result = "0-1";

    return {
      id: g.id,
      pgn: g.pgn || "",
      white: whiteName,
      black: blackName,
      result,
      openingFamily: openingFamily(rawOpening),
      playerColor,
      opponent,
    };
  });
}

// ─── PGN header extraction (simple regex, no chess.js) ───────────────────────

function extractPgnHeader(pgn: string, key: string): string | null {
  const match = pgn.match(new RegExp(`\\[${key}\\s+"([^"]*)"\\]`));
  return match?.[1] && match[1] !== "?" ? match[1] : null;
}

/**
 * Resolve an opening name using the same logic as the pipeline (aggregate.ts).
 * Priority: ECO_NAMES map → PGN [Opening] header → ECO code → "Unknown"
 */
function resolveOpeningName(eco: string | null, opening: string | null): string {
  if (eco && ECO_NAMES[eco]) return ECO_NAMES[eco];
  if (opening && opening !== "?") return opening;
  return eco || "Unknown";
}

/**
 * Normalize a FIDE name for case-insensitive matching.
 * Strips accents, lowercases, and ensures consistent comma spacing
 * (PGN uses "Caruana,F" while FIDE uses "Caruana, Fabiano").
 */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/,/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert raw FIDE PGN strings into GameForDrilldown[] for the OpeningsTab.
 * Uses simple regex header extraction — no chess.js parsing needed.
 */
export function fideGamesToDrilldown(
  rawPgns: string[],
  playerName: string
): GameForDrilldown[] {
  const normalizedPlayer = normalizeName(playerName);

  return rawPgns.map((pgn, i) => {
    const white = extractPgnHeader(pgn, "White") || "White";
    const black = extractPgnHeader(pgn, "Black") || "Black";
    const result = extractPgnHeader(pgn, "Result") || "*";
    const event = extractPgnHeader(pgn, "Event");
    const date = extractPgnHeader(pgn, "Date");
    const round = extractPgnHeader(pgn, "Round");
    const eco = extractPgnHeader(pgn, "ECO");
    const opening = extractPgnHeader(pgn, "Opening");
    const resolvedOpening = resolveOpeningName(eco, opening);
    const whiteFideId = extractPgnHeader(pgn, "WhiteFideId") || "";
    const blackFideId = extractPgnHeader(pgn, "BlackFideId") || "";

    // Determine player color by matching normalized names
    const isWhite = normalizeName(white).includes(normalizedPlayer) ||
      normalizedPlayer.includes(normalizeName(white));
    const playerColor: "white" | "black" = isWhite ? "white" : "black";
    const opponent = isWhite ? black : white;

    // Generate game page slug for linking to /game/...
    const slug = whiteFideId && blackFideId
      ? generateGameSlug(white, black, event, date, round, whiteFideId, blackFideId)
      : `fide-game-${i}`;

    return {
      id: slug,
      pgn,
      white,
      black,
      result,
      openingFamily: openingFamily(resolvedOpening),
      playerColor,
      opponent,
      date: date || undefined,
      event: event || undefined,
    };
  });
}

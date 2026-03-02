/**
 * Unified game representation for all sources (Lichess, FIDE, uploaded PGN).
 *
 * All source-specific types are converted to NormalizedGame at the boundary,
 * then the entire analysis pipeline works on NormalizedGame[].
 */

import type {
  LichessGame,
  LichessEvalAnnotation,
  OTBGame,
  GameEvalData,
} from "./types";
import type { GameRecord } from "@outprep/engine";
import { classifyOpening } from "./analysis/eco-classifier";
import { openingFamily } from "./profile-builder";
import { generateGameSlug } from "./game-slug";
import { ECO_NAMES } from "../../packages/fide-pipeline/src/eco-names";
import type { GameForDrilldown } from "./game-helpers";

export type GameSource = "lichess" | "fide" | "pgn";

export interface NormalizedGame {
  id: string;
  pgn: string;
  moves: string;
  white: { name: string; id: string };
  black: { name: string; id: string };
  /** Game result: which color won, draw, or undefined (aborted/ongoing) */
  result: "white" | "black" | "draw" | undefined;
  opening: { eco: string; name: string; family: string };
  source: GameSource;
  playerColor: "white" | "black";

  // Optional fields (source-dependent)
  date?: string;
  event?: string;
  speed?: string;
  variant?: string;
  evals?: number[];
  createdAt?: number;
  rated?: boolean;
  clock?: { initial: number; increment: number };
}

// ─── Adapters: source-specific → NormalizedGame ───────────────────────────

function evalToCp(annotation: LichessEvalAnnotation): number {
  if (annotation.eval !== undefined) return annotation.eval;
  if (annotation.mate !== undefined) return annotation.mate > 0 ? 10000 : -10000;
  return 0;
}

export function fromLichessGame(
  game: LichessGame,
  username: string,
): NormalizedGame {
  const isWhite =
    game.players.white?.user?.id?.toLowerCase() === username.toLowerCase();
  const whiteName = game.players.white.user?.name || "White";
  const blackName = game.players.black.user?.name || "Black";

  let result: NormalizedGame["result"];
  if (game.winner === "white") result = "white";
  else if (game.winner === "black") result = "black";
  else if (game.status === "draw" || game.status === "stalemate") result = "draw";

  const evals = game.analysis?.map(evalToCp);
  let rawOpening = game.opening?.name || "";
  let rawEco = game.opening?.eco || "";
  if (!rawOpening && game.moves) {
    const classified = classifyOpening(game.moves);
    rawOpening = classified?.name || "Unknown";
    rawEco = classified?.eco || rawEco;
  }
  if (!rawOpening) rawOpening = "Unknown";

  // Construct a minimal PGN from the moves field if the API didn't include one.
  // chess.js's loadPgn() needs proper PGN with move numbers.
  let pgn = game.pgn || "";
  if (!pgn && game.moves) {
    const sans = game.moves.split(/\s+/);
    const parts: string[] = [];
    for (let i = 0; i < sans.length; i++) {
      if (i % 2 === 0) parts.push(`${Math.floor(i / 2) + 1}.`);
      parts.push(sans[i]);
    }
    pgn = parts.join(" ");
  }

  return {
    id: game.id,
    pgn,
    moves: game.moves,
    white: { name: whiteName, id: game.players.white.user?.id || "" },
    black: { name: blackName, id: game.players.black.user?.id || "" },
    result,
    opening: {
      eco: rawEco,
      name: rawOpening,
      family: openingFamily(rawOpening),
    },
    source: "lichess",
    playerColor: isWhite ? "white" : "black",
    speed: game.speed,
    variant: game.variant,
    evals,
    createdAt: game.createdAt,
    rated: game.rated,
    clock: game.clock,
  };
}

/**
 * Classify a PGN TimeControl header value into a speed category.
 *
 * Chess.com formats:
 *   "180"        → 3 min total (blitz)
 *   "600+5"      → 600 base + 5 increment (rapid)
 *   "60+1"       → 60 base + 1 increment (bullet)
 *   "1/259200"   → correspondence (excluded)
 *
 * Speed thresholds (total = base + 40 * increment):
 *   bullet    < 180s  (3 min)
 *   blitz     < 480s  (8 min)
 *   rapid     < 1500s (25 min)
 *   classical >= 1500s
 */
export function classifyTimeControl(tc: string | undefined): string | undefined {
  if (!tc) return undefined;
  // Correspondence: "1/259200" format — exclude
  if (tc.includes("/")) return undefined;
  const parts = tc.split("+");
  const base = parseInt(parts[0], 10);
  if (isNaN(base)) return undefined;
  const increment = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  const estimated = base + 40 * (isNaN(increment) ? 0 : increment);
  if (estimated < 180) return "bullet";
  if (estimated < 480) return "blitz";
  if (estimated < 1500) return "rapid";
  return "classical";
}

/**
 * Classify speed from FIDE event name.
 * Matches keywords like "Rapid", "Blitz" in event titles.
 */
export function classifyEventSpeed(event: string | undefined): string | undefined {
  if (!event) return undefined;
  const lower = event.toLowerCase();
  if (/\brapid\b/.test(lower)) return "rapid";
  if (/\bblitz\b/.test(lower)) return "blitz";
  return undefined;
}

export function fromOTBGame(
  game: OTBGame,
  username: string,
  index: number,
): NormalizedGame {
  // Normalize to alphanumeric for matching (handles slug-format names and PGN "Last, First" format)
  const lower = username.toLowerCase().replace(/[^a-z0-9]/g, "");
  const whiteNorm = game.white.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Check both directions: PGN name contains username, or username contains PGN name
  // (handles abbreviated FIDE names like "Caruana,F" for "Caruana, Fabiano")
  const isWhite = whiteNorm.includes(lower) || (whiteNorm.length >= 4 && lower.includes(whiteNorm));

  // Prefer ECO_NAMES lookup (e.g., "Sicilian Defense") over raw PGN header (e.g., "Sicilian")
  let rawOpening = resolveOpeningName(game.eco || null, game.opening || null);
  if (rawOpening === "Unknown") {
    const classified = classifyOpening(game.moves);
    rawOpening = classified?.name || "Unknown";
  }

  // Construct a minimal PGN from the moves field if pgn is empty (e.g., stripped compact games)
  let pgn = game.pgn || "";
  if (!pgn && game.moves) {
    const sans = game.moves.split(/\s+/);
    const parts: string[] = [];
    for (let i = 0; i < sans.length; i++) {
      if (i % 2 === 0) parts.push(`${Math.floor(i / 2) + 1}.`);
      parts.push(sans[i]);
    }
    pgn = parts.join(" ");
  }

  return {
    id: `otb-${index}`,
    pgn,
    moves: game.moves,
    white: {
      name: game.white,
      id: game.white.toLowerCase().replace(/[^a-z0-9]/g, ""),
    },
    black: {
      name: game.black,
      id: game.black.toLowerCase().replace(/[^a-z0-9]/g, ""),
    },
    result:
      game.result === "1-0" ? "white"
        : game.result === "0-1" ? "black"
          : game.result === "1/2-1/2" ? "draw"
            : undefined,
    opening: {
      eco: game.eco || "",
      name: rawOpening,
      family: openingFamily(rawOpening),
    },
    source: "pgn",
    playerColor: isWhite ? "white" : "black",
    variant: "standard",
    speed: classifyTimeControl(game.timeControl) || classifyEventSpeed(game.event) || "classical",
    date: game.date,
    event: game.event,
  };
}

// ─── PGN header extraction (simple regex, no chess.js) ────────────────────

function extractPgnHeader(pgn: string, key: string): string | null {
  const match = pgn.match(new RegExp(`\\[${key}\\s+"([^"]*)"\\]`));
  return match?.[1] && match[1] !== "?" ? match[1] : null;
}

function resolveOpeningName(eco: string | null, opening: string | null): string {
  if (eco && ECO_NAMES[eco]) return ECO_NAMES[eco];
  if (opening && opening !== "?") return opening;
  return eco || "Unknown";
}

function normalizeFideName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/,/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fromFidePGN(
  pgn: string,
  playerName: string,
  index: number,
  playerFideId?: string,
): NormalizedGame {
  const normalizedPlayer = normalizeFideName(playerName);
  const white = extractPgnHeader(pgn, "White") || "White";
  const black = extractPgnHeader(pgn, "Black") || "Black";
  const resultStr = extractPgnHeader(pgn, "Result") || "*";
  const event = extractPgnHeader(pgn, "Event");
  const date = extractPgnHeader(pgn, "Date");
  const round = extractPgnHeader(pgn, "Round");
  const eco = extractPgnHeader(pgn, "ECO");
  const opening = extractPgnHeader(pgn, "Opening");
  const resolvedOpening = resolveOpeningName(eco, opening);
  const whiteFideId = extractPgnHeader(pgn, "WhiteFideId") || "";
  const blackFideId = extractPgnHeader(pgn, "BlackFideId") || "";

  // Prefer FIDE ID matching over name matching for reliable color detection
  let isWhite: boolean;
  if (playerFideId && (whiteFideId || blackFideId)) {
    isWhite = whiteFideId === playerFideId;
  } else {
    isWhite =
      normalizeFideName(white).includes(normalizedPlayer) ||
      normalizedPlayer.includes(normalizeFideName(white));
  }

  const slug =
    whiteFideId && blackFideId
      ? generateGameSlug(white, black, event, date, round, whiteFideId, blackFideId)
      : `fide-game-${index}`;

  return {
    id: slug,
    pgn,
    moves: "", // FIDE PGN move extraction not needed for drilldown display
    white: { name: white, id: whiteFideId || white.toLowerCase().replace(/[^a-z0-9]/g, "") },
    black: { name: black, id: blackFideId || black.toLowerCase().replace(/[^a-z0-9]/g, "") },
    result:
      resultStr === "1-0" ? "white"
        : resultStr === "0-1" ? "black"
          : resultStr === "1/2-1/2" ? "draw"
            : undefined,
    opening: {
      eco: eco || "",
      name: resolvedOpening,
      family: openingFamily(resolvedOpening),
    },
    source: "fide",
    playerColor: isWhite ? "white" : "black",
    variant: "standard",
    date: date || undefined,
    event: event || undefined,
  };
}

// ─── Converters: NormalizedGame → downstream types ────────────────────────

export function normalizedToGameForDrilldown(game: NormalizedGame): GameForDrilldown {
  let result = "1/2-1/2";
  if (game.result === "white") result = "1-0";
  else if (game.result === "black") result = "0-1";

  const opponent =
    game.playerColor === "white" ? game.black.name : game.white.name;

  return {
    id: game.id,
    pgn: game.pgn,
    white: game.white.name,
    black: game.black.name,
    result,
    openingFamily: game.opening.family,
    playerColor: game.playerColor,
    opponent,
    date: game.date,
    event: game.event,
  };
}

export function normalizedToGameRecord(game: NormalizedGame): GameRecord {
  return {
    moves: game.moves,
    playerColor: game.playerColor,
    result: game.result,
  };
}

export function normalizedToGameEvalData(game: NormalizedGame): GameEvalData | null {
  if (!game.evals || game.evals.length === 0) return null;
  if (!game.moves || game.variant !== "standard") return null;
  return {
    moves: game.moves,
    playerColor: game.playerColor,
    evals: game.evals,
  };
}

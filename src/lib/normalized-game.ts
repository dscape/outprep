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
  const rawOpening = game.opening?.name || "Unknown";

  return {
    id: game.id,
    pgn: game.pgn || "",
    moves: game.moves,
    white: { name: whiteName, id: game.players.white.user?.id || "" },
    black: { name: blackName, id: game.players.black.user?.id || "" },
    result,
    opening: {
      eco: game.opening?.eco || "",
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

export function fromOTBGame(
  game: OTBGame,
  username: string,
  index: number,
): NormalizedGame {
  const lower = username.toLowerCase();
  const isWhite = game.white.toLowerCase().includes(lower);

  let rawOpening = game.opening || "";
  if (!rawOpening && game.eco) rawOpening = game.eco;
  if (!rawOpening) {
    const classified = classifyOpening(game.moves);
    rawOpening = classified?.name || "Unknown";
  }

  return {
    id: `otb-${index}`,
    pgn: game.pgn,
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
    speed: "classical",
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

  const isWhite =
    normalizeFideName(white).includes(normalizedPlayer) ||
    normalizedPlayer.includes(normalizeFideName(white));

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

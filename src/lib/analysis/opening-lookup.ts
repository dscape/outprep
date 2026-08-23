import { Chess } from "chess.js";
import { classifyOpening } from "./eco-classifier";

/** Identify an opening from PGN using the bundled ECO database. */
export function lookupOpening(
  pgn: string,
  fallback = "Unknown Opening",
): string {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);

    const moves = chess.history().join(" ");
    return classifyOpening(moves)?.name ?? fallback;
  } catch {
    return fallback;
  }
}

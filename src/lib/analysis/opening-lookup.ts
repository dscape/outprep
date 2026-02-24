/**
 * Opening lookup using Lichess opening explorer API.
 * Identifies the opening from a sequence of moves.
 */

import { Chess } from "chess.js";

/**
 * Look up the opening name from a PGN or move sequence.
 * Uses the free Lichess opening explorer endpoint (no auth required).
 */
export async function lookupOpening(pgn: string): Promise<string> {
  try {
    const chess = new Chess();

    // Try to load PGN
    try {
      chess.loadPgn(pgn);
    } catch {
      return "Unknown Opening";
    }

    const history = chess.history({ verbose: true });
    if (history.length === 0) return "Unknown Opening";

    // Build UCI move sequence for the first ~20 moves (opening phase)
    const maxMoves = Math.min(history.length, 20);
    const uciMoves: string[] = [];

    for (let i = 0; i < maxMoves; i++) {
      const move = history[i];
      let uci = move.from + move.to;
      if (move.promotion) uci += move.promotion;
      uciMoves.push(uci);
    }

    // Query Lichess opening explorer — try with progressively fewer moves
    // until we get a named opening
    for (let len = maxMoves; len >= 2; len--) {
      const play = uciMoves.slice(0, len).join(",");
      const url = `https://explorer.lichess.ovh/masters?play=${play}`;

      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) continue;

      const data = await response.json();

      if (data.opening && data.opening.name) {
        return data.opening.name;
      }
    }

    return "Unknown Opening";
  } catch {
    return "Unknown Opening";
  }
}

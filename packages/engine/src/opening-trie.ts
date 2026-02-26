import { Chess } from "chess.js";
import type { OpeningTrie, TrieNode, TrieMove, GameRecord, BotConfig } from "./types";
import { DEFAULT_CONFIG } from "./config";

/**
 * Normalize a FEN by dropping halfmove and fullmove clocks.
 * This merges transpositions that reach the same position.
 */
function normalizeFen(fen: string): string {
  const parts = fen.split(" ");
  // Keep: position, side to move, castling, en passant
  return parts.slice(0, 4).join(" ");
}

/**
 * Build an opening trie from game records for the profiled player's color.
 *
 * Walks the games, records what the player played at each position.
 * Only includes positions with minGames+ games. Stops after maxPly plies.
 *
 * @param games - Generic game records (app maps LichessGame → GameRecord)
 * @param color - Which color to profile ("white" or "black")
 * @param config - Trie parameters (maxPly, minGames)
 */
export function buildOpeningTrie(
  games: GameRecord[],
  color: "white" | "black",
  config: Pick<BotConfig, "trie"> = DEFAULT_CONFIG
): OpeningTrie {
  const { maxPly, minGames } = config.trie;

  // Accumulate: fenKey → moveUCI → { count, wins, draws }
  const positions = new Map<
    string,
    Map<string, { san: string; count: number; wins: number; draws: number }>
  >();

  for (const game of games) {
    if (!game.moves) continue;

    const isWhite = game.playerColor === "white";

    // Only use games where the player played the requested color
    if (
      (color === "white" && !isWhite) ||
      (color === "black" && isWhite)
    ) continue;

    const moves = game.moves.split(" ");
    const chess = new Chess();

    // Determine if the player won/drew from their perspective
    const playerWon =
      (isWhite && game.result === "white") ||
      (!isWhite && game.result === "black");
    const isDraw = game.result === "draw";

    for (let ply = 0; ply < Math.min(moves.length, maxPly); ply++) {
      const isWhiteMove = ply % 2 === 0;
      const isPlayerMove =
        (isWhite && isWhiteMove) || (!isWhite && !isWhiteMove);

      // Only record moves made by the profiled player
      if (isPlayerMove) {
        const fenKey = normalizeFen(chess.fen());

        if (!positions.has(fenKey)) {
          positions.set(fenKey, new Map());
        }

        const moveMap = positions.get(fenKey)!;
        const san = moves[ply];

        // Convert SAN to UCI
        try {
          const moveObj = chess.move(san);
          if (!moveObj) continue;

          const uci =
            moveObj.from +
            moveObj.to +
            (moveObj.promotion ? moveObj.promotion : "");

          // Validate UCI format
          if (uci.length < 4) continue;

          const entry = moveMap.get(uci) || {
            san,
            count: 0,
            wins: 0,
            draws: 0,
          };
          entry.count++;
          if (playerWon) entry.wins++;
          if (isDraw) entry.draws++;
          moveMap.set(uci, entry);

          // chess already advanced from the move above
          continue;
        } catch {
          break;
        }
      }

      // Advance position for non-player moves
      try {
        chess.move(moves[ply]);
      } catch {
        break;
      }
    }
  }

  // Convert to trie format, filtering by minGames
  const trie: OpeningTrie = {};

  for (const [fenKey, moveMap] of positions) {
    const totalGames = Array.from(moveMap.values()).reduce(
      (sum, e) => sum + e.count,
      0
    );

    if (totalGames < minGames) continue;

    const trieMoves: TrieMove[] = [];
    for (const [uci, entry] of moveMap) {
      if (entry.count < 1) continue;
      trieMoves.push({
        uci,
        san: entry.san,
        count: entry.count,
        winRate: entry.count > 0 ? entry.wins / entry.count : 0,
      });
    }

    // Sort by count descending
    trieMoves.sort((a, b) => b.count - a.count);

    if (trieMoves.length > 0) {
      trie[fenKey] = { moves: trieMoves, totalGames };
    }
  }

  return trie;
}

/**
 * Look up the current position in the trie.
 * Returns the available moves or null if out of book.
 */
export function lookupTrie(
  trie: OpeningTrie,
  fen: string
): TrieNode | null {
  const key = normalizeFen(fen);
  return trie[key] || null;
}

/**
 * Sample a move from a trie node, weighted by count and optionally win rate.
 *
 * When winBias > 0, moves with higher win rates get proportionally more weight:
 *   weight = count * (1 + winBias * (winRate - 0.5))
 *
 * At winBias=0: pure frequency sampling (original behavior).
 * At winBias=1: a move with 75% winRate gets 25% more weight;
 *               a move with 25% winRate gets 25% less weight.
 *
 * Returns the selected TrieMove or null if node is empty.
 */
export function sampleTrieMove(node: TrieNode, winBias: number = 0): TrieMove | null {
  if (node.moves.length === 0) return null;

  const weights = node.moves.map((m) => {
    const base = m.count;
    if (winBias === 0) return base;
    // Blend frequency with success rate
    return Math.max(0.1, base * (1 + winBias * (m.winRate - 0.5)));
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let rand = Math.random() * totalWeight;

  for (let i = 0; i < node.moves.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return node.moves[i];
  }

  return node.moves[0];
}

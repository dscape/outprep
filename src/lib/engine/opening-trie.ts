import { Chess } from "chess.js";
import { LichessGame } from "../types";

/**
 * JSON move trie for opponent opening book.
 * Keyed by normalized FEN (board + side + castling + en passant, dropping clocks).
 */
export interface TrieNode {
  moves: TrieMove[];
  totalGames: number;
}

export interface TrieMove {
  uci: string;
  san: string;
  count: number;
  winRate: number; // 0-1, from the player's perspective
}

export interface OpeningTrie {
  [fenKey: string]: TrieNode;
}

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
 * Build an opening trie from the opponent's games for a specific color.
 *
 * Walks the opponent's games, records what they played at each position.
 * Only includes positions with minGames+ games. Stops after maxPly plies.
 */
export function buildOpeningTrie(
  games: LichessGame[],
  username: string,
  color: "white" | "black",
  maxPly = 40, // 20 moves = 40 plies
  minGames = 3
): OpeningTrie {
  // Accumulate: fenKey → moveUCI → { count, wins, draws }
  const positions = new Map<
    string,
    Map<string, { san: string; count: number; wins: number; draws: number }>
  >();

  for (const game of games) {
    if (!game.moves || game.variant !== "standard") continue;

    const isWhite =
      game.players.white?.user?.id?.toLowerCase() === username.toLowerCase();

    // Only use games where the opponent played the requested color
    if ((color === "white" && !isWhite) || (color === "black" && isWhite)) continue;

    const moves = game.moves.split(" ");
    const chess = new Chess();

    // Determine if the opponent won/drew from their perspective
    const opponentWon =
      (isWhite && game.winner === "white") ||
      (!isWhite && game.winner === "black");
    const isDraw = !game.winner;

    for (let ply = 0; ply < Math.min(moves.length, maxPly); ply++) {
      const isWhiteMove = ply % 2 === 0;
      const isPlayerMove =
        (isWhite && isWhiteMove) || (!isWhite && !isWhiteMove);

      // Only record moves made by the target player (opponent)
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
          if (opponentWon) entry.wins++;
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
      if (entry.count < 1) continue; // Include all moves for positions that meet threshold
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
 * Sample a move from a trie node, weighted by count.
 * Returns the selected TrieMove or null if node is empty.
 */
export function sampleTrieMove(node: TrieNode): TrieMove | null {
  if (node.moves.length === 0) return null;

  const totalWeight = node.moves.reduce((sum, m) => sum + m.count, 0);
  let rand = Math.random() * totalWeight;

  for (const move of node.moves) {
    rand -= move.count;
    if (rand <= 0) return move;
  }

  return node.moves[0];
}

import { Chess } from "chess.js";
import type { NormalizedGame } from "./normalized-game";

interface BookEntry {
  hash: bigint;
  move: number;
  weight: number;
  learn: number;
}

/**
 * Generate a polyglot opening book from a player's games.
 * Returns a Uint8Array in polyglot .bin format.
 */
export function generateOpeningBook(
  games: NormalizedGame[],
  maxPly = 30,
  minGames = 3
): Uint8Array {
  // Count move frequencies at each position
  const positionMoves = new Map<string, Map<string, number>>();

  for (const game of games) {
    if (!game.moves || (game.variant ?? "standard") !== "standard") continue;

    const isWhite = game.playerColor === "white";
    const moves = game.moves.split(" ");
    const chess = new Chess();

    for (let i = 0; i < Math.min(moves.length, maxPly); i++) {
      const fen = chess.fen();
      const turn = chess.turn();

      // Only record moves made by the target player
      const isPlayerTurn = (turn === "w" && isWhite) || (turn === "b" && !isWhite);

      if (isPlayerTurn) {
        const posKey = fenToPositionKey(fen);

        if (!positionMoves.has(posKey)) {
          positionMoves.set(posKey, new Map());
        }

        const moveMap = positionMoves.get(posKey)!;
        const moveStr = moves[i];
        moveMap.set(moveStr, (moveMap.get(moveStr) || 0) + 1);
      }

      try {
        chess.move(moves[i]);
      } catch {
        break;
      }
    }
  }

  // Build polyglot entries
  const entries: BookEntry[] = [];

  for (const [posKey, moveMap] of positionMoves) {
    for (const [moveSan, count] of moveMap) {
      if (count < minGames) continue;

      const chess = new Chess(posKey);
      try {
        const move = chess.move(moveSan);
        if (!move) continue;

        const hash = polyglotHash(posKey);
        const polyMove = encodePolyglotMove(move.from, move.to, move.promotion);

        entries.push({
          hash,
          move: polyMove,
          weight: Math.min(count * 100, 65535),
          learn: 0,
        });
      } catch {
        // skip invalid moves
      }
    }
  }

  // Sort by hash for binary search
  entries.sort((a, b) => {
    if (a.hash < b.hash) return -1;
    if (a.hash > b.hash) return 1;
    return b.weight - a.weight;
  });

  return encodePolyglotBook(entries);
}

/**
 * Look up moves for a position in a polyglot book.
 */
export function lookupPosition(
  book: Uint8Array,
  fen: string
): { from: string; to: string; weight: number; promotion?: string }[] {
  const hash = polyglotHash(fen);
  const entrySize = 16;
  const numEntries = Math.floor(book.length / entrySize);
  const results: { from: string; to: string; weight: number; promotion?: string }[] = [];

  // Binary search for the first entry with matching hash
  let lo = 0;
  let hi = numEntries - 1;
  let firstMatch = -1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const entryHash = readUint64(book, mid * entrySize);

    if (entryHash === hash) {
      firstMatch = mid;
      hi = mid - 1; // find first occurrence
    } else if (entryHash < hash) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (firstMatch === -1) return results;

  // Collect all entries with matching hash
  for (let i = firstMatch; i < numEntries; i++) {
    const offset = i * entrySize;
    const entryHash = readUint64(book, offset);
    if (entryHash !== hash) break;

    const moveData = readUint16(book, offset + 8);
    const weight = readUint16(book, offset + 10);

    const decoded = decodePolyglotMove(moveData);
    if (decoded) {
      results.push({ ...decoded, weight });
    }
  }

  return results.sort((a, b) => b.weight - a.weight);
}

function fenToPositionKey(fen: string): string {
  // Return just the position part for consistent FEN comparison
  return fen;
}

// Simplified polyglot Zobrist hashing
// In a real implementation, this would use the full 781 random numbers
// For our purposes, we use a simplified hash that's good enough for book lookups
const HASH_SEED = BigInt("0x9E3779B97F4A7C15");

function polyglotHash(fen: string): bigint {
  const parts = fen.split(" ");
  const position = parts[0];
  const turn = parts[1];
  const castling = parts[2] || "-";
  const enPassant = parts[3] || "-";

  let hash = BigInt(0);

  // Hash piece placement
  const rows = position.split("/");
  for (let rank = 0; rank < 8; rank++) {
    let file = 0;
    for (const ch of rows[rank]) {
      if (ch >= "1" && ch <= "8") {
        file += parseInt(ch);
      } else {
        const pieceIndex = pieceToIndex(ch);
        const square = rank * 8 + file;
        hash ^= pseudoRandom(pieceIndex * 64 + square);
        file++;
      }
    }
  }

  // Hash turn
  if (turn === "w") {
    hash ^= pseudoRandom(780);
  }

  // Hash castling
  if (castling.includes("K")) hash ^= pseudoRandom(768);
  if (castling.includes("Q")) hash ^= pseudoRandom(769);
  if (castling.includes("k")) hash ^= pseudoRandom(770);
  if (castling.includes("q")) hash ^= pseudoRandom(771);

  // Hash en passant
  if (enPassant !== "-") {
    const epFile = enPassant.charCodeAt(0) - "a".charCodeAt(0);
    hash ^= pseudoRandom(772 + epFile);
  }

  return hash;
}

function pieceToIndex(piece: string): number {
  const map: Record<string, number> = {
    P: 0, N: 1, B: 2, R: 3, Q: 4, K: 5,
    p: 6, n: 7, b: 8, r: 9, q: 10, k: 11,
  };
  return map[piece] ?? 0;
}

function pseudoRandom(index: number): bigint {
  // Simple deterministic hash function for Zobrist values
  let h = HASH_SEED ^ BigInt(index) * BigInt("0x517CC1B727220A95");
  h = ((h >> BigInt(16)) ^ h) * BigInt("0x45D9F3B");
  h = ((h >> BigInt(16)) ^ h) * BigInt("0x45D9F3B");
  h = (h >> BigInt(16)) ^ h;
  return h & BigInt("0xFFFFFFFFFFFFFFFF");
}

function encodePolyglotMove(from: string, to: string, promotion?: string | null): number {
  const fromFile = from.charCodeAt(0) - "a".charCodeAt(0);
  const fromRank = parseInt(from[1]) - 1;
  const toFile = to.charCodeAt(0) - "a".charCodeAt(0);
  const toRank = parseInt(to[1]) - 1;

  let promoValue = 0;
  if (promotion) {
    const promoMap: Record<string, number> = { n: 1, b: 2, r: 3, q: 4 };
    promoValue = promoMap[promotion.toLowerCase()] || 0;
  }

  return (toFile) | (toRank << 3) | (fromFile << 6) | (fromRank << 9) | (promoValue << 12);
}

function decodePolyglotMove(move: number): { from: string; to: string; promotion?: string } | null {
  const toFile = move & 0x7;
  const toRank = (move >> 3) & 0x7;
  const fromFile = (move >> 6) & 0x7;
  const fromRank = (move >> 9) & 0x7;
  const promo = (move >> 12) & 0x7;

  const from = String.fromCharCode("a".charCodeAt(0) + fromFile) + (fromRank + 1);
  const to = String.fromCharCode("a".charCodeAt(0) + toFile) + (toRank + 1);

  const promoMap: Record<number, string> = { 1: "n", 2: "b", 3: "r", 4: "q" };
  const promotion = promoMap[promo];

  return { from, to, ...(promotion ? { promotion } : {}) };
}

function encodePolyglotBook(entries: BookEntry[]): Uint8Array {
  const buffer = new Uint8Array(entries.length * 16);
  const view = new DataView(buffer.buffer);

  for (let i = 0; i < entries.length; i++) {
    const offset = i * 16;
    const entry = entries[i];

    // Write hash as big-endian 64-bit
    const hi = Number((entry.hash >> BigInt(32)) & BigInt(0xFFFFFFFF));
    const lo = Number(entry.hash & BigInt(0xFFFFFFFF));
    view.setUint32(offset, hi);
    view.setUint32(offset + 4, lo);

    // Write move, weight, learn as big-endian 16-bit
    view.setUint16(offset + 8, entry.move);
    view.setUint16(offset + 10, entry.weight);
    view.setUint32(offset + 12, entry.learn);
  }

  return buffer;
}

function readUint64(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset);
  const hi = BigInt(view.getUint32(offset));
  const lo = BigInt(view.getUint32(offset + 4));
  return (hi << BigInt(32)) | lo;
}

function readUint16(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer, data.byteOffset);
  return view.getUint16(offset);
}

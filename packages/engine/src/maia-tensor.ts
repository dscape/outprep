import { Chess } from "chess.js";

export interface MaiaLegalMove {
  uci: string;
  index: number;
}

export interface MaiaInput {
  tokens: Float32Array;
  legalMoves: MaiaLegalMove[];
}

const PIECES = ["P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"];
const PROMOTIONS = ["q", "r", "b", "n"];

/** Build Maia-3's side-to-move-normalized (64, 12) board input. */
export function preprocessMaiaPosition(fen: string): MaiaInput {
  const activeColor = fen.split(" ")[1];
  if (activeColor !== "w" && activeColor !== "b") {
    throw new Error(`Invalid FEN active color: ${fen}`);
  }

  const mirrored = activeColor === "b";
  const normalizedFen = mirrored ? mirrorFen(fen) : fen;
  const tokens = boardTokens(normalizedFen);
  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true }).map((move) => {
    const originalUci = `${move.from}${move.to}${move.promotion || ""}`;
    const modelUci = mirrored ? mirrorMove(originalUci) : originalUci;
    return { uci: originalUci, index: maiaMoveIndex(modelUci) };
  });

  return { tokens, legalMoves };
}

export function probabilitiesForLegalMoves(
  logits: Float32Array,
  legalMoves: MaiaLegalMove[],
): Array<MaiaLegalMove & { probability: number }> {
  if (logits.length !== 4352) {
    throw new Error(`Unexpected Maia policy output size: ${logits.length}`);
  }
  if (legalMoves.length === 0) return [];

  const max = Math.max(...legalMoves.map((move) => logits[move.index]));
  const weights = legalMoves.map((move) => Math.exp(logits[move.index] - max));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Maia returned an invalid legal-move distribution");
  }

  return legalMoves
    .map((move, index) => ({ ...move, probability: weights[index] / total }))
    .sort((a, b) => b.probability - a.probability);
}

export function sampleMaiaMove(
  moves: Array<MaiaLegalMove & { probability: number }>,
  random = Math.random,
): MaiaLegalMove & { probability: number } {
  if (moves.length === 0) throw new Error("No legal Maia moves to sample");
  let target = random();
  for (const move of moves) {
    target -= move.probability;
    if (target <= 0) return move;
  }
  return moves[moves.length - 1];
}

export function maiaMoveIndex(uci: string): number {
  const from = squareIndex(uci.slice(0, 2));
  const to = squareIndex(uci.slice(2, 4));
  const promotion = uci[4];
  if (!promotion) return from * 64 + to;

  const pieceIndex = PROMOTIONS.indexOf(promotion);
  if (pieceIndex < 0 || uci[1] !== "7" || uci[3] !== "8") {
    throw new Error(`Invalid normalized promotion move: ${uci}`);
  }
  const fromFile = uci.charCodeAt(0) - 97;
  const toFile = uci.charCodeAt(2) - 97;
  return 4096 + (fromFile * 8 + toFile) * 4 + pieceIndex;
}

export function mirrorMove(uci: string): string {
  return `${mirrorSquare(uci.slice(0, 2))}${mirrorSquare(uci.slice(2, 4))}${uci.slice(4)}`;
}

function boardTokens(fen: string): Float32Array {
  const placement = fen.split(" ")[0];
  const rows = placement.split("/");
  if (rows.length !== 8) throw new Error(`Invalid FEN placement: ${fen}`);

  const tokens = new Float32Array(64 * 12);
  for (let fenRank = 0; fenRank < 8; fenRank++) {
    const boardRank = 7 - fenRank;
    let file = 0;
    for (const char of rows[fenRank]) {
      const empty = Number(char);
      if (Number.isInteger(empty) && empty > 0) {
        file += empty;
        continue;
      }
      const piece = PIECES.indexOf(char);
      if (piece < 0 || file > 7) throw new Error(`Invalid FEN placement: ${fen}`);
      tokens[(boardRank * 8 + file) * 12 + piece] = 1;
      file++;
    }
    if (file !== 8) throw new Error(`Invalid FEN placement: ${fen}`);
  }
  return tokens;
}

function mirrorFen(fen: string): string {
  const [placement, activeColor, castling, enPassant, halfmove = "0", fullmove = "1"] = fen.split(" ");
  const mirroredPlacement = placement
    .split("/")
    .reverse()
    .map((rank) => [...rank].map(swapPieceColor).join(""))
    .join("/");
  const mirroredCastling = swapCastling(castling);
  const mirroredEnPassant = enPassant === "-" ? "-" : mirrorSquare(enPassant);
  const nextColor = activeColor === "b" ? "w" : "b";
  return `${mirroredPlacement} ${nextColor} ${mirroredCastling} ${mirroredEnPassant} ${halfmove} ${fullmove}`;
}

function swapPieceColor(char: string): string {
  if (/[a-z]/.test(char)) return char.toUpperCase();
  if (/[A-Z]/.test(char)) return char.toLowerCase();
  return char;
}

function swapCastling(castling: string): string {
  if (castling === "-") return "-";
  const swapped = [
    castling.includes("k") ? "K" : "",
    castling.includes("q") ? "Q" : "",
    castling.includes("K") ? "k" : "",
    castling.includes("Q") ? "q" : "",
  ].join("");
  return swapped || "-";
}

function mirrorSquare(square: string): string {
  return `${square[0]}${9 - Number(square[1])}`;
}

function squareIndex(square: string): number {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  if (file < 0 || file > 7 || rank < 0 || rank > 7) {
    throw new Error(`Invalid square: ${square}`);
  }
  return rank * 8 + file;
}

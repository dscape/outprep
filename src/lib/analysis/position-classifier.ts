import { Chess } from "chess.js";
import { MoveEval } from "../types";

export interface PositionContext {
  ply: number;
  phase: "opening" | "middlegame" | "endgame";
  materialBalance: number;
  pawnStructure: string;
  kingSafety: "safe" | "exposed" | "castled" | "uncastled";
  tacticalMotifs: string[];
}

export function classifyPositions(
  pgn: string,
  moves: MoveEval[]
): PositionContext[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  chess.reset();

  const headerMatch = pgn.match(/\[FEN "([^"]+)"\]/);
  if (headerMatch) {
    chess.load(headerMatch[1]);
  }

  const contexts: PositionContext[] = [];

  for (let i = 0; i < history.length; i++) {
    const moveEval = moves[i];
    if (!moveEval || Math.abs(moveEval.evalDelta) < 50) {
      chess.move(history[i].san);
      continue;
    }

    const board = chess.board();
    const phase = detectPhase(board, i);
    const materialBalance = calculateMaterialBalance(board);
    const pawnStructure = analyzePawnStructure(board);
    const kingSafety = assessKingSafety(chess);
    const tacticalMotifs = detectTacticalMotifs(chess, history[i]);

    contexts.push({
      ply: i + 1,
      phase,
      materialBalance,
      pawnStructure,
      kingSafety,
      tacticalMotifs,
    });

    chess.move(history[i].san);
  }

  return contexts;
}

function detectPhase(
  board: ReturnType<Chess["board"]>,
  ply: number
): "opening" | "middlegame" | "endgame" {
  let pieceCount = 0;
  let queenCount = 0;

  for (const row of board) {
    for (const sq of row) {
      if (sq && sq.type !== "p" && sq.type !== "k") {
        pieceCount++;
        if (sq.type === "q") queenCount++;
      }
    }
  }

  if (ply <= 15) return "opening";
  if (pieceCount <= 6 || (queenCount === 0 && pieceCount <= 8)) return "endgame";
  return "middlegame";
}

function calculateMaterialBalance(board: ReturnType<Chess["board"]>): number {
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let balance = 0;

  for (const row of board) {
    for (const sq of row) {
      if (sq && sq.type !== "k") {
        const val = values[sq.type] || 0;
        balance += sq.color === "w" ? val : -val;
      }
    }
  }

  return balance;
}

function analyzePawnStructure(board: ReturnType<Chess["board"]>): string {
  const whitePawns: number[] = [];
  const blackPawns: number[] = [];

  for (const row of board) {
    for (const sq of row) {
      if (sq?.type === "p") {
        const file = row.indexOf(sq);
        if (sq.color === "w") whitePawns.push(file);
        else blackPawns.push(file);
      }
    }
  }

  // Detect doubled pawns
  const whiteDoubled = whitePawns.length - new Set(whitePawns).size;
  const blackDoubled = blackPawns.length - new Set(blackPawns).size;

  // Detect isolated pawns
  const whiteFiles = new Set(whitePawns);
  const blackFiles = new Set(blackPawns);
  let whiteIsolated = 0;
  let blackIsolated = 0;

  for (const f of whiteFiles) {
    if (!whiteFiles.has(f - 1) && !whiteFiles.has(f + 1)) whiteIsolated++;
  }
  for (const f of blackFiles) {
    if (!blackFiles.has(f - 1) && !blackFiles.has(f + 1)) blackIsolated++;
  }

  if (whiteDoubled > 0 || blackDoubled > 0) return "doubled pawns";
  if (whiteIsolated > 1 || blackIsolated > 1) return "isolated pawns";
  if (whitePawns.length + blackPawns.length < 6) return "open position";
  return "standard";
}

function assessKingSafety(chess: Chess): "safe" | "exposed" | "castled" | "uncastled" {
  const fen = chess.fen();
  const castling = fen.split(" ")[2] || "";

  if (chess.isCheck()) return "exposed";

  // Check if kings have castled (simplified check)
  const board = chess.board();
  const whiteKingPos = findKing(board, "w");
  const blackKingPos = findKing(board, "b");

  if (whiteKingPos && (whiteKingPos.file === 6 || whiteKingPos.file === 2)) {
    return "castled";
  }
  if (blackKingPos && (blackKingPos.file === 6 || blackKingPos.file === 2)) {
    return "castled";
  }

  if (castling !== "-" && castling !== "") return "uncastled";
  return "safe";
}

function findKing(
  board: ReturnType<Chess["board"]>,
  color: "w" | "b"
): { rank: number; file: number } | null {
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const sq = board[rank][file];
      if (sq?.type === "k" && sq.color === color) {
        return { rank, file };
      }
    }
  }
  return null;
}

function detectTacticalMotifs(
  chess: Chess,
  move: ReturnType<Chess["history"]>[number] & { flags?: string; captured?: string }
): string[] {
  const motifs: string[] = [];

  if (chess.isCheck()) motifs.push("check");
  if (typeof move === "object" && "captured" in move && move.captured) motifs.push("capture");

  // Check for discovered attacks, pins, etc. (simplified)
  const legalMoves = chess.moves({ verbose: true });
  const captures = legalMoves.filter((m) => m.captured);
  if (captures.length >= 3) motifs.push("multiple threats");

  if (chess.isCheckmate()) motifs.push("checkmate");

  return motifs;
}

/**
 * Human think time estimation — predicts how long a human would take to
 * find a given move based on position complexity, move type, and eval volatility.
 *
 * Three weighted signals:
 *   1. Position complexity (0.4) — legal move count as proxy for decision space
 *   2. Move type heuristics (0.3) — forced/recapture/check/quiet/sacrifice
 *   3. Eval volatility (0.3) — spread among top candidates
 */

import { Chess } from "chess.js";
import type { CandidateMove } from "./types";

/* ── Public types ────────────────────────────────────────────── */

export type ThinkDifficulty =
  | "instant"
  | "quick"
  | "moderate"
  | "deep"
  | "critical";

export interface HumanThinkEstimate {
  /** Estimated thinking time in milliseconds (1000–25000) */
  thinkTimeMs: number;
  /** Human-readable label, e.g. "~3s" */
  thinkTimeLabel: string;
  /** Difficulty category */
  difficulty: ThinkDifficulty;
}

/* ── Main function ───────────────────────────────────────────── */

/**
 * Estimate how long a human of similar strength would take to find this move.
 *
 * @param fen - Position FEN *before* the move is played
 * @param moveUci - The UCI move that was played (e.g. "e2e4")
 * @param candidates - MultiPV candidate list (sorted best-first)
 */
export function estimateHumanThinkTime(
  fen: string,
  moveUci: string,
  candidates: CandidateMove[]
): HumanThinkEstimate {
  const complexityMs = estimateComplexityTime(fen);
  const moveTypeMs = estimateMoveTypeTime(fen, moveUci);
  const evalVolatilityMs = estimateEvalVolatilityTime(candidates);

  const rawMs =
    complexityMs * 0.4 + moveTypeMs * 0.3 + evalVolatilityMs * 0.3;

  // Add deterministic jitter based on FEN hash (±15%)
  const hash = simpleHash(fen + moveUci);
  const jitterFactor = 0.85 + (hash % 31) / 100; // 0.85–1.15
  const thinkTimeMs = clamp(Math.round(rawMs * jitterFactor), 1000, 25000);

  const difficulty = classifyDifficulty(thinkTimeMs);
  const seconds = Math.round(thinkTimeMs / 1000);
  const thinkTimeLabel = `~${seconds}s`;

  return { thinkTimeMs, thinkTimeLabel, difficulty };
}

/* ── Signal 1: Position Complexity ───────────────────────────── */

/**
 * More legal moves = bigger decision tree = more time.
 * Base: 2000ms for ≤15 moves, scaling to 15000ms for 40+ moves.
 */
function estimateComplexityTime(fen: string): number {
  try {
    const chess = new Chess(fen);
    const legalMoves = chess.moves().length;

    if (legalMoves <= 1) return 1000; // forced — instant
    if (legalMoves <= 5) return 1500; // very limited choices
    if (legalMoves <= 15) return 2000 + (legalMoves - 5) * 100; // 2000–3000
    if (legalMoves <= 30) return 3000 + (legalMoves - 15) * 400; // 3000–9000
    return 9000 + (legalMoves - 30) * 600; // 9000–15000+
  } catch {
    return 5000; // fallback
  }
}

/* ── Signal 2: Move Type Heuristics ──────────────────────────── */

const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

/**
 * Move type affects how quickly a human finds it:
 *   - Forced (1-2 legal moves): 1–2s (obvious)
 *   - Recaptures: 2–4s (reflexive)
 *   - Captures: 4–7s (need to evaluate trade)
 *   - Checks: 5–9s (calculate consequences)
 *   - Quiet moves: 6–12s (require positional evaluation)
 *   - Sacrifices: 10–20s (deep calculation)
 */
function estimateMoveTypeTime(fen: string, moveUci: string): number {
  try {
    const chess = new Chess(fen);
    const legalMoves = chess.moves().length;

    // Forced move — only 1-2 legal choices
    if (legalMoves <= 2) return 1500;

    // Check if the previous move was a capture (for recapture detection)
    const history = chess.history({ verbose: true });
    const lastMove = history.length > 0 ? history[history.length - 1] : null;
    const lastWasCapture = lastMove?.captured != null;
    const lastCaptureTo = lastMove?.to;

    // Play the move to analyze it
    const from = moveUci.substring(0, 2);
    const to = moveUci.substring(2, 4);
    const promotion =
      moveUci.length > 4
        ? (moveUci[4] as "q" | "r" | "b" | "n")
        : undefined;
    const move = chess.move({ from, to, promotion });
    if (!move) return 6000; // fallback

    // Recapture — quick reflexive response
    if (move.captured && lastWasCapture && to === lastCaptureTo) {
      return 2500;
    }

    // Sacrifice — moving a higher-value piece to a square where it gets captured
    // Heuristic: capturing a lower-value piece with a higher-value piece into danger
    if (move.captured) {
      const movingPieceValue = PIECE_VALUES[move.piece] || 0;
      const capturedPieceValue = PIECE_VALUES[move.captured] || 0;
      if (movingPieceValue > capturedPieceValue + 1) {
        // e.g., queen takes pawn — might be a sacrifice
        return 12000;
      }
      // Normal capture
      return 5000;
    }

    // Check — need to calculate consequences
    if (chess.inCheck()) {
      return 7000;
    }

    // Quiet move — positional evaluation needed
    return 8000;
  } catch {
    return 6000; // fallback
  }
}

/* ── Signal 3: Eval Volatility ───────────────────────────────── */

/**
 * When candidates have similar evals, the decision is harder.
 * When there's a clear best move, it's easier.
 *
 *   topTwoGap < 20cp → very close (10–15s)
 *   topTwoGap > 100cp → clear best (2–5s)
 *   evalSpread < 50cp → flat position, all moves similar (8–12s)
 *   evalSpread > 300cp → wide range, some moves terrible (4–6s, clear avoid)
 */
function estimateEvalVolatilityTime(candidates: CandidateMove[]): number {
  if (candidates.length <= 1) return 3000; // single candidate, nothing to ponder

  const topTwoGap = Math.abs(candidates[0].score - candidates[1].score);
  const lastIdx = candidates.length - 1;
  const evalSpread = Math.abs(candidates[0].score - candidates[lastIdx].score);

  // Top-two gap drives primary decision time
  let gapTime: number;
  if (topTwoGap <= 10) gapTime = 14000; // essentially equal — agonizing
  else if (topTwoGap <= 20) gapTime = 11000; // very close
  else if (topTwoGap <= 50) gapTime = 8000; // moderately close
  else if (topTwoGap <= 100) gapTime = 5000; // decent gap
  else gapTime = 3000; // clear best

  // Eval spread provides context
  let spreadAdjust: number;
  if (evalSpread <= 30) spreadAdjust = 2000; // flat — all moves similar, confusing
  else if (evalSpread <= 100) spreadAdjust = 0; // normal
  else spreadAdjust = -1500; // wide spread — easy to spot bad moves

  return clamp(gapTime + spreadAdjust, 2000, 16000);
}

/* ── Helpers ─────────────────────────────────────────────────── */

function classifyDifficulty(ms: number): ThinkDifficulty {
  if (ms < 2000) return "instant";
  if (ms < 5000) return "quick";
  if (ms < 10000) return "moderate";
  if (ms < 18000) return "deep";
  return "critical";
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Simple deterministic hash for jitter — NOT cryptographic */
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

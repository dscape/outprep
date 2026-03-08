import { Chess } from "chess.js";
import type { BotMoveResult, CandidateMove, MoveType, ThinkDifficulty } from "@outprep/engine";
import { temperatureFromSkill, classifyMove as classifyMoveType, estimateHumanThinkTime } from "@outprep/engine";

// Same thresholds as LiveGameAnalyzer
const INACCURACY_THRESHOLD = 50;
const MISTAKE_THRESHOLD = 100;
const BLUNDER_THRESHOLD = 200;

export type TrueClassification =
  | "great"
  | "good"
  | "normal"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export interface DebugMoveEntry {
  ply: number;
  result: BotMoveResult;
  fen: string; // Position FEN before bot moved
  moveSan: string; // SAN of bot's move (always resolved)
  selectedRank: number; // 1 = best, 0 = book (no ranking)
  cpLoss: number; // vs bot's own best candidate
  reasoning: string;
  selectionProbabilities: number[]; // Boltzmann probs per candidate
  temperature: number;
  candidateTypes: MoveType[]; // capture/check/quiet per candidate
  // Full-strength Stockfish comparison (from LiveGameAnalyzer)
  stockfishEval: number | null; // eval before bot moved (cp, side-to-move perspective)
  stockfishBestMove: string | null; // what Stockfish recommends (UCI)
  stockfishBestMoveSan: string | null; // SAN version
  evalAfter: number | null; // eval after bot moved (cp, side-to-move perspective)
  trueCpLoss: number | null; // eval delta = how much the bot's move cost
  trueClassification: TrueClassification | null;
  // Player context
  playerMoveSan: string | null; // Player's preceding move (SAN), for "1. e4 e5" display
  // Human think time estimation
  humanThinkTimeMs: number | null; // Estimated human thinking time in ms
  humanThinkTimeLabel: string | null; // "~3s", "~12s"
  humanDifficulty: ThinkDifficulty | null; // "instant" | "quick" | "moderate" | "deep" | "critical"
}

/**
 * Build a debug entry for a bot move, optionally enriched with full-strength Stockfish data.
 *
 * @param ply - Move number (half-move count)
 * @param result - BotMoveResult from the bot controller
 * @param fen - Position FEN before the bot moved
 * @param stockfishBefore - Full-strength eval of position BEFORE bot moved (from LiveAnalyzer)
 * @param stockfishAfter - Full-strength eval of position AFTER bot moved (from LiveAnalyzer)
 */
export function buildDebugEntry(
  ply: number,
  result: BotMoveResult,
  fen: string,
  stockfishBefore?: { eval: number; bestMove: string; fen: string } | null,
  stockfishAfter?: { eval: number } | null,
  playerMoveSan?: string | null
): DebugMoveEntry {
  const temperature = temperatureFromSkill(result.dynamicSkill);
  const candidates = result.candidates || [];

  // Compute Boltzmann selection probabilities
  const selectionProbabilities = computeBoltzmannProbabilities(
    candidates,
    temperature
  );

  // Classify each candidate move as capture/check/quiet
  const candidateTypes: MoveType[] = candidates.map((c) =>
    classifyMoveType(fen, c.uci)
  );

  // Resolve SAN for the bot's move
  const moveSan =
    result.san ||
    uciToSan(fen, result.uci) ||
    result.uci;

  // Compute Stockfish comparison
  let stockfishEval: number | null = null;
  let stockfishBestMove: string | null = null;
  let stockfishBestMoveSan: string | null = null;
  let evalAfter: number | null = null;
  let trueCpLoss: number | null = null;
  let trueClassification: TrueClassification | null = null;

  if (stockfishBefore) {
    stockfishEval = stockfishBefore.eval;
    stockfishBestMove = stockfishBefore.bestMove;

    // Convert Stockfish best move from UCI to SAN
    stockfishBestMoveSan = uciToSan(
      stockfishBefore.fen,
      stockfishBefore.bestMove
    );

    if (stockfishAfter != null) {
      evalAfter = stockfishAfter.eval;

      // Compute true CPL using same formula as LiveGameAnalyzer (lines 96-108)
      // Both evals are from side-to-move's perspective
      // Before: side-to-move is the bot
      // After: side-to-move has flipped to the player
      // So evalAfter from the bot's perspective = -stockfishAfter.eval
      const evalBeforeForMover = stockfishBefore.eval;
      const evalAfterForMover = -stockfishAfter.eval;
      trueCpLoss = evalBeforeForMover - evalAfterForMover;

      // Classify using standard thresholds
      if (trueCpLoss >= BLUNDER_THRESHOLD) {
        trueClassification = "blunder";
      } else if (trueCpLoss >= MISTAKE_THRESHOLD) {
        trueClassification = "mistake";
      } else if (trueCpLoss >= INACCURACY_THRESHOLD) {
        trueClassification = "inaccuracy";
      } else if (trueCpLoss <= -30) {
        trueClassification = "great";
      } else if (trueCpLoss <= 0) {
        trueClassification = "good";
      } else {
        trueClassification = "normal";
      }
    }
  }

  if (result.source === "book") {
    return {
      ply,
      result,
      fen,
      moveSan,
      selectedRank: 0,
      cpLoss: 0,
      reasoning: `Book move: ${moveSan}\nFollowing opponent's opening repertoire.\nPhase: ${result.phase}\nThink time: ${result.thinkTimeMs}ms`,
      selectionProbabilities: [],
      temperature,
      candidateTypes: [],
      stockfishEval,
      stockfishBestMove,
      stockfishBestMoveSan,
      evalAfter,
      trueCpLoss,
      trueClassification,
      playerMoveSan: playerMoveSan ?? null,
      humanThinkTimeMs: null,
      humanThinkTimeLabel: null,
      humanDifficulty: null,
    };
  }

  const selectedUci = result.uci;
  const selectedIdx = candidates.findIndex((c) => c.uci === selectedUci);
  const selectedRank = selectedIdx >= 0 ? selectedIdx + 1 : 1;

  const bestCandidate = candidates[0];
  const selectedCandidate = selectedIdx >= 0 ? candidates[selectedIdx] : null;
  const cpLoss =
    bestCandidate && selectedCandidate
      ? bestCandidate.score - selectedCandidate.score
      : 0;

  let reasoning = `Phase: ${result.phase} | Skill: ${result.dynamicSkill} | Temp: ${temperature.toFixed(2)}`;

  if (candidates.length === 0) {
    reasoning += `\nFallback: single best move (no MultiPV candidates).`;
  } else {
    reasoning += `\n${candidates.length} candidates (depth ${candidates[0]?.depth}):`;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const marker = c.uci === selectedUci ? " <<" : "";
      const scoreStr = c.score >= 0 ? `+${c.score}` : `${c.score}`;
      const prob =
        selectionProbabilities[i] !== undefined
          ? ` (${(selectionProbabilities[i] * 100).toFixed(1)}%)`
          : "";
      const typeLabel = candidateTypes[i] === "capture" ? " [AGG]" : candidateTypes[i] === "check" ? " [TAC]" : " [POS]";
      reasoning += `\n  ${i + 1}. ${c.san || uciToSan(fen, c.uci) || c.uci} (${scoreStr}cp)${prob}${typeLabel}${marker}`;
    }
  }

  // Stockfish comparison in reasoning
  if (trueCpLoss !== null && trueClassification) {
    reasoning += `\n\nStockfish: ${stockfishBestMoveSan || stockfishBestMove} (eval ${formatEval(stockfishEval)})`;
    reasoning += `\nBot played: ${moveSan} (eval after ${formatEval(evalAfter != null ? -evalAfter : null)})`;
    reasoning += `\nTrue CPL: ${trueCpLoss}cp — ${trueClassification.toUpperCase()}`;
  } else if (stockfishBefore && !stockfishAfter) {
    reasoning += `\n\nStockfish best: ${stockfishBestMoveSan || stockfishBestMove} — awaiting eval after...`;
  }

  reasoning += `\nThink time: ${result.thinkTimeMs}ms`;

  // Estimate human think time for engine moves with candidates
  let humanThinkTimeMs: number | null = null;
  let humanThinkTimeLabel: string | null = null;
  let humanDifficulty: ThinkDifficulty | null = null;

  if (candidates.length > 0) {
    const estimate = estimateHumanThinkTime(fen, result.uci, candidates);
    humanThinkTimeMs = estimate.thinkTimeMs;
    humanThinkTimeLabel = estimate.thinkTimeLabel;
    humanDifficulty = estimate.difficulty;
    reasoning += `\nHuman think: ${estimate.thinkTimeLabel} (${estimate.difficulty})`;
  }

  return {
    ply,
    result,
    fen,
    moveSan,
    selectedRank: candidates.length === 0 ? 1 : selectedRank,
    cpLoss,
    reasoning,
    selectionProbabilities,
    temperature,
    candidateTypes,
    stockfishEval,
    stockfishBestMove,
    stockfishBestMoveSan,
    evalAfter,
    trueCpLoss,
    trueClassification,
    playerMoveSan: playerMoveSan ?? null,
    humanThinkTimeMs,
    humanThinkTimeLabel,
    humanDifficulty,
  };
}

/**
 * Classify a move for display — uses true Stockfish classification when available,
 * falls back to bot's own candidate comparison.
 *
 * Color scheme:
 *   red    = blunder (≥200cp loss)
 *   yellow = mistake/inaccuracy (≥50cp loss)
 *   green  = normal/good (small or no CPL)
 *   blue   = brilliant/best (found a hard best move)
 */
export function classifyMove(entry: DebugMoveEntry): {
  label: string;
  color: string;
} {
  if (entry.result.source === "book") {
    return { label: "BOOK", color: "green" };
  }

  // Use true classification from Stockfish when available
  if (entry.trueClassification) {
    switch (entry.trueClassification) {
      case "blunder":
        return { label: "BLUNDER", color: "red" };
      case "mistake":
        return { label: "MISTAKE", color: "yellow" };
      case "inaccuracy":
        return { label: "INACCURACY", color: "yellow" };
      case "great":
        return { label: "BRILLIANT", color: "blue" };
      case "good":
        return { label: "GOOD", color: "green" };
      case "normal":
        return { label: "OK", color: "green" };
    }
  }

  // Fallback: no Stockfish data yet
  const candidates = entry.result.candidates || [];
  if (candidates.length === 0) {
    return { label: "?", color: "zinc" };
  }
  if (entry.selectedRank === 1) {
    return { label: "BEST", color: "blue" };
  }
  if (entry.cpLoss >= 300) {
    return { label: "BLUNDER", color: "red" };
  }
  if (entry.cpLoss >= 100) {
    return { label: "MISTAKE", color: "yellow" };
  }
  if (entry.cpLoss >= 30) {
    return { label: "SUB", color: "yellow" };
  }
  return { label: "OK", color: "green" };
}

/* ── Helpers ──────────────────────────────────────────────── */

function uciToSan(fen: string, uci: string): string | null {
  if (!uci || uci.length < 4) return null;
  try {
    const chess = new Chess(fen);
    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);
    const promotion =
      uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined;
    const move = chess.move({ from, to, promotion });
    return move ? move.san : uci;
  } catch {
    return uci;
  }
}

function formatEval(cp: number | null): string {
  if (cp === null) return "?";
  const sign = cp >= 0 ? "+" : "";
  return `${sign}${(cp / 100).toFixed(2)}`;
}

/**
 * Compute Boltzmann (softmax) selection probabilities for candidates.
 * Uses centipawn scores divided by temperature.
 * Matches the formula in boltzmannSelect() from move-selector.ts.
 */
function computeBoltzmannProbabilities(
  candidates: CandidateMove[],
  temperature: number
): number[] {
  if (candidates.length === 0 || temperature <= 0) return [];

  // score / temperature — matches boltzmannSelect in move-selector.ts
  const maxScore = Math.max(...candidates.map((c) => c.score));
  const exps = candidates.map((c) =>
    Math.exp((c.score - maxScore) / temperature)
  );
  const sumExp = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sumExp);
}

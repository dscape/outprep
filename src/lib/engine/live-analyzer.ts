/**
 * Live game analyzer — runs a second Stockfish instance during gameplay
 * to pre-compute move evaluations. By game end, analysis is instant.
 *
 * Uses depth 12 (vs depth 18 in post-game). The error classification
 * thresholds (50/100/200cp) are reliably distinguishable at depth 12.
 */

import { Chess } from "chess.js";
import { StockfishEngine } from "../stockfish-worker";
import { MoveEval, AnalysisSummary } from "../types";

const ANALYSIS_DEPTH = 12;

const INACCURACY_THRESHOLD = 50;
const MISTAKE_THRESHOLD = 100;
const BLUNDER_THRESHOLD = 200;

interface PositionEval {
  fen: string;
  eval: number; // centipawns from side-to-move's perspective
  bestMove: string; // UCI notation
}

export class LiveGameAnalyzer {
  private engine: StockfishEngine;
  private positionEvals: Map<number, PositionEval> = new Map();
  private evalQueue: Array<{ ply: number; fen: string }> = [];
  private processing = false;
  private initialized = false;
  private stopped = false;

  constructor() {
    this.engine = new StockfishEngine();
  }

  async init(): Promise<void> {
    await this.engine.init();
    this.initialized = true;
    // Start processing loop
    this.processQueue();
  }

  /**
   * Queue a position for background evaluation.
   * ply 0 = starting position (before any move),
   * ply 1 = after first move (white's move), etc.
   */
  recordPosition(ply: number, fen: string): void {
    if (this.stopped) return;
    this.evalQueue.push({ ply, fen });
    this.processQueue();
  }

  /**
   * Check if all positions up to totalPlies have been evaluated.
   * totalPlies = number of moves played (e.g., 80 for a 40-move game).
   * We need evals for plies 0 through totalPlies (inclusive).
   */
  isComplete(totalPlies: number): boolean {
    for (let i = 0; i <= totalPlies; i++) {
      if (!this.positionEvals.has(i)) return false;
    }
    return true;
  }

  /**
   * Build MoveEval[] and AnalysisSummary from accumulated evaluations.
   * Returns null if not all positions are evaluated yet.
   *
   * @param history - SAN move list (e.g., ["e4", "e5", "Nf3", ...])
   * @param playerColor - which side the human played
   */
  buildAnalysis(
    history: string[],
    playerColor: "white" | "black"
  ): { moves: MoveEval[]; summary: AnalysisSummary } | null {
    // We need eval before each move (ply 0..N-1) and after each move (ply 1..N)
    // ply i = position after i moves have been played
    // For move i (0-indexed): before = ply i, after = ply i+1
    for (let i = 0; i <= history.length; i++) {
      if (!this.positionEvals.has(i)) return null;
    }

    const moves: MoveEval[] = [];

    for (let i = 0; i < history.length; i++) {
      const beforeEval = this.positionEvals.get(i)!;
      const afterEval = this.positionEvals.get(i + 1)!;

      const isWhiteTurn = i % 2 === 0;

      // Convert evals to white's perspective
      // Engine returns eval from side-to-move's perspective
      // Before move i: side-to-move is determined by i
      const evalBeforeWhite = isWhiteTurn
        ? beforeEval.eval
        : -beforeEval.eval;

      // After move i: side-to-move has flipped
      const evalAfterWhite = isWhiteTurn
        ? -afterEval.eval
        : afterEval.eval;

      // Eval delta from the moving side's perspective
      const evalBeforeForMover = isWhiteTurn ? evalBeforeWhite : -evalBeforeWhite;
      const evalAfterForMover = isWhiteTurn ? evalAfterWhite : -evalAfterWhite;
      const evalDelta = evalBeforeForMover - evalAfterForMover;

      // Classify
      let classification: MoveEval["classification"] = "normal";
      if (evalDelta >= BLUNDER_THRESHOLD) {
        classification = "blunder";
      } else if (evalDelta >= MISTAKE_THRESHOLD) {
        classification = "mistake";
      } else if (evalDelta >= INACCURACY_THRESHOLD) {
        classification = "inaccuracy";
      } else if (evalDelta <= -30) {
        classification = "great";
      } else if (evalDelta <= 0) {
        classification = "good";
      }

      // Convert best move from UCI to SAN
      let bestMoveSan = beforeEval.bestMove;
      try {
        const tempChess = new Chess(beforeEval.fen);
        const from = beforeEval.bestMove.substring(0, 2);
        const to = beforeEval.bestMove.substring(2, 4);
        const promo = beforeEval.bestMove.length > 4
          ? beforeEval.bestMove[4]
          : undefined;
        const bestMoveObj = tempChess.move({
          from,
          to,
          promotion: promo as "q" | "r" | "b" | "n" | undefined,
        });
        if (bestMoveObj) bestMoveSan = bestMoveObj.san;
      } catch {
        // Keep UCI notation as fallback
      }

      moves.push({
        ply: i + 1,
        san: history[i],
        fen: beforeEval.fen,
        eval: evalBeforeWhite,
        bestMove: beforeEval.bestMove,
        bestMoveSan,
        evalDelta,
        classification,
        exploitMove: afterEval.bestMove, // opponent's best response after this move
      });
    }

    const summary = this.computeSummary(moves, playerColor);
    return { moves, summary };
  }

  /**
   * Count how many positions from 0 to totalPlies have been evaluated.
   */
  countEvaluated(totalPlies: number): number {
    let count = 0;
    for (let i = 0; i <= totalPlies; i++) {
      if (this.positionEvals.has(i)) count++;
    }
    return count;
  }

  /**
   * Wait for all positions up to totalPlies to be evaluated.
   * Returns true if complete, false if timed out.
   */
  async waitForCompletion(
    totalPlies: number,
    timeoutMs = 30000,
    onProgress?: (evaluated: number, total: number) => void,
  ): Promise<boolean> {
    const total = totalPlies + 1; // plies 0 through totalPlies
    const start = Date.now();
    while (!this.isComplete(totalPlies) && !this.stopped) {
      if (Date.now() - start > timeoutMs) return false;
      if (onProgress) {
        onProgress(this.countEvaluated(totalPlies), total);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return this.isComplete(totalPlies);
  }

  quit(): void {
    this.stopped = true;
    this.evalQueue = [];
    this.engine.quit();
  }

  private async processQueue(): Promise<void> {
    if (this.processing || !this.initialized || this.stopped) return;
    this.processing = true;

    while (this.evalQueue.length > 0 && !this.stopped) {
      const item = this.evalQueue.shift()!;

      // Skip if already evaluated
      if (this.positionEvals.has(item.ply)) continue;

      try {
        const result = await this.engine.evaluate(item.fen, ANALYSIS_DEPTH);
        if (this.stopped) break;

        this.positionEvals.set(item.ply, {
          fen: item.fen,
          eval: result.eval,
          bestMove: result.bestMove,
        });
      } catch (err) {
        console.error(`LiveAnalyzer eval error at ply ${item.ply}:`, err);
        // Re-queue on error (once)
        if (!this.stopped) {
          this.positionEvals.set(item.ply, {
            fen: item.fen,
            eval: 0,
            bestMove: "",
          });
        }
      }
    }

    this.processing = false;
  }

  private computeSummary(
    moves: MoveEval[],
    playerColor: "white" | "black"
  ): AnalysisSummary {
    let totalCPL = 0;
    let blunders = 0;
    let mistakes = 0;
    let inaccuracies = 0;
    let moveCount = 0;

    for (const move of moves) {
      const isWhiteMove = move.ply % 2 === 1;
      const isPlayerMove =
        (playerColor === "white" && isWhiteMove) ||
        (playerColor === "black" && !isWhiteMove);
      if (!isPlayerMove) continue;

      if (move.evalDelta > 0) {
        // Cap at 500cp so mate-score blunders don't dominate the average
        totalCPL += Math.min(move.evalDelta, 500);
      }
      moveCount++;

      if (move.classification === "blunder") blunders++;
      if (move.classification === "mistake") mistakes++;
      if (move.classification === "inaccuracy") inaccuracies++;
    }

    const averageCentipawnLoss =
      moveCount > 0 ? Math.round(totalCPL / moveCount) : 0;

    const accuracy = Math.round(
      Math.min(100, Math.max(0, 100 * Math.exp(-0.004 * averageCentipawnLoss)))
    );

    return {
      averageCentipawnLoss,
      accuracy,
      blunders,
      mistakes,
      inaccuracies,
    };
  }
}

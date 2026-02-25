/**
 * Adapter that wraps the browser WASM StockfishEngine to implement
 * the platform-agnostic ChessEngine interface from @outprep/engine.
 */

import type { ChessEngine, CandidateMove } from "@outprep/engine";
import { StockfishEngine } from "./stockfish-worker";

export class WasmStockfishAdapter implements ChessEngine {
  constructor(private engine: StockfishEngine) {}

  async evaluateMultiPV(
    fen: string,
    depth: number,
    numPV: number,
    skillLevel?: number
  ): Promise<CandidateMove[]> {
    const results = await this.engine.evaluateMultiPV(fen, depth, numPV, skillLevel);
    return results.map((r) => ({
      uci: r.bestMove,
      score: r.eval,
      depth: r.depth,
      pv: r.pv,
    }));
  }

  async evaluate(fen: string, depth: number): Promise<CandidateMove> {
    const result = await this.engine.evaluate(fen, depth);
    return {
      uci: result.bestMove,
      score: result.eval,
      depth: result.depth,
      pv: result.pv,
    };
  }

  dispose(): void {
    this.engine.quit();
  }
}

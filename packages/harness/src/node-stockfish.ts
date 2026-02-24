/**
 * Node.js Stockfish adapter implementing ChessEngine.
 *
 * Uses the stockfish npm package's single-threaded WASM build
 * in Node.js mode. The module exports a double-factory pattern:
 *   outerFactory() → innerFactory({ locateFile, listener }) → Promise<EmscriptenModule>
 *
 * Commands are sent via: module.ccall('command', 'void', ['string'], [uciCmd])
 * Output is received via the listener callback.
 */

import type { ChessEngine, CandidateMove } from "@outprep/engine";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EmscriptenModule = any;

export class NodeStockfishAdapter implements ChessEngine {
  private sf: EmscriptenModule = null;
  private messageHandlers: ((line: string) => void)[] = [];

  async init(): Promise<void> {
    const require = createRequire(import.meta.url);
    const sfPath = require.resolve("stockfish/bin/stockfish-18-single.js");
    const wasmDir = dirname(sfPath);

    // Double-factory pattern: outerFactory() → innerFactory(opts) → Promise<module>
    const outerFactory = require(sfPath);
    const innerFactory = outerFactory();

    this.sf = await innerFactory({
      locateFile: (file: string) => {
        // The module requests 'stockfish.wasm' but the actual file is 'stockfish-18-single.wasm'
        if (file.endsWith(".wasm")) return join(wasmDir, "stockfish-18-single.wasm");
        return join(wasmDir, file);
      },
      listener: (line: string) => {
        for (const handler of this.messageHandlers) {
          handler(line);
        }
      },
    });

    // UCI handshake
    await this.sendAndWait("uci", "uciok");
  }

  private send(cmd: string): void {
    this.sf?.ccall("command", "void", ["string"], [cmd]);
  }

  private sendAndWait(cmd: string, expected: string): Promise<void> {
    return new Promise((resolve) => {
      const handler = (line: string) => {
        if (line.includes(expected)) {
          this.removeHandler(handler);
          resolve();
        }
      };
      this.messageHandlers.push(handler);
      this.send(cmd);
    });
  }

  private removeHandler(handler: (line: string) => void): void {
    const idx = this.messageHandlers.indexOf(handler);
    if (idx !== -1) this.messageHandlers.splice(idx, 1);
  }

  /**
   * MultiPV analysis — returns top N candidate moves with scores.
   * Replicates the UCI parsing from src/lib/stockfish-worker.ts:134-212.
   */
  async evaluateMultiPV(
    fen: string,
    depth: number,
    numPV: number
  ): Promise<CandidateMove[]> {
    await this.sendAndWait("isready", "readyok");
    this.send(`setoption name MultiPV value ${numPV}`);
    await this.sendAndWait("isready", "readyok");
    this.send(`position fen ${fen}`);

    return new Promise((resolve) => {
      const pvResults = new Map<
        number,
        { score: number; depth: number; pv: string; move: string }
      >();

      const handler = (msg: string) => {
        if (msg.startsWith("info") && msg.includes("score")) {
          const depthMatch = msg.match(/depth (\d+)/);
          const multipvMatch = msg.match(/multipv (\d+)/);
          const scoreMatch = msg.match(/score (cp|mate) (-?\d+)/);
          const pvMatch = msg.match(/ pv (.+)/);

          if (!depthMatch || !scoreMatch || !pvMatch) return;

          const d = parseInt(depthMatch[1]);
          const pvIdx = multipvMatch ? parseInt(multipvMatch[1]) : 1;

          let evalScore: number;
          if (scoreMatch[1] === "cp") {
            evalScore = parseInt(scoreMatch[2]);
          } else {
            // Mate score — same conversion as stockfish-worker.ts
            const mateIn = parseInt(scoreMatch[2]);
            evalScore = mateIn > 0 ? 30000 - mateIn : -30000 - mateIn;
          }

          const pvLine = pvMatch[1];
          const firstMove = pvLine.split(" ")[0] || "";

          // Keep highest depth for each PV index
          const existing = pvResults.get(pvIdx);
          if (!existing || d >= existing.depth) {
            pvResults.set(pvIdx, {
              score: evalScore,
              depth: d,
              pv: pvLine,
              move: firstMove,
            });
          }
        }

        if (msg.startsWith("bestmove")) {
          this.removeHandler(handler);

          // NOTE: Do NOT send commands here — we're inside a ccall listener
          // callback. Nested ccall causes WASM corruption. MultiPV is set
          // at the beginning of each evaluateMultiPV call instead.

          // Build results sorted by score (best first)
          const results: CandidateMove[] = Array.from(pvResults.values())
            .map((r) => ({
              uci: r.move,
              score: r.score,
              depth: r.depth,
              pv: r.pv,
            }))
            .sort((a, b) => b.score - a.score);

          resolve(results);
        }
      };

      this.messageHandlers.push(handler);
      this.send(`go depth ${depth}`);
    });
  }

  async evaluate(fen: string, depth: number): Promise<CandidateMove> {
    const results = await this.evaluateMultiPV(fen, depth, 1);
    return results[0];
  }

  dispose(): void {
    try {
      this.send("quit");
    } catch {
      // Ignore errors during cleanup
    }
    this.sf = null;
    this.messageHandlers = [];
  }
}

// ── Smoke test ─────────────────────────────────────────────────────
// Run with: npx tsx packages/harness/src/node-stockfish.ts
if (process.argv[1]?.endsWith("node-stockfish.ts")) {
  (async () => {
    console.log("Initializing Stockfish...");
    const engine = new NodeStockfishAdapter();
    await engine.init();
    console.log("Stockfish ready.\n");

    const startFen =
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    console.log("Evaluating starting position (depth 10, MultiPV 4)...");
    const candidates = await engine.evaluateMultiPV(startFen, 10, 4);
    for (const c of candidates) {
      console.log(`  ${c.uci}  score=${c.score}cp  depth=${c.depth}`);
    }

    console.log("\nSingle eval (depth 12)...");
    const best = await engine.evaluate(startFen, 12);
    console.log(
      `  Best: ${best.uci}  score=${best.score}cp  depth=${best.depth}`
    );

    engine.dispose();
    console.log("\nDone.");
    process.exit(0);
  })();
}

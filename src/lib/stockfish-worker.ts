/**
 * Stockfish WASM Web Worker wrapper.
 * All Stockfish computation happens client-side in a Web Worker.
 */

export interface StockfishEvalResult {
  bestMove: string;
  eval: number; // centipawns from side-to-move's perspective
  depth: number;
  pv: string;
}

export class StockfishEngine {
  private worker: Worker | null = null;
  private ready = false;
  private messageQueue: ((msg: string) => void)[] = [];
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve, reject) => {
      try {
        // Load stockfish from public directory (single-threaded WASM build)
        this.worker = new Worker("/stockfish.js");

        this.worker.onmessage = (e: MessageEvent) => {
          const msg = typeof e.data === "string" ? e.data : String(e.data);

          if (msg.includes("uciok")) {
            this.ready = true;
            resolve();
          }

          // Process waiting listeners
          if (this.messageQueue.length > 0) {
            const handler = this.messageQueue[0];
            handler(msg);
          }
        };

        this.worker.onerror = (e) => {
          reject(new Error(`Stockfish worker error: ${e.message}`));
        };

        this.send("uci");
      } catch (err) {
        reject(err);
      }
    });

    return this.initPromise;
  }

  private send(command: string): void {
    this.worker?.postMessage(command);
  }

  async isReady(): Promise<void> {
    return new Promise<void>((resolve) => {
      const handler = (msg: string) => {
        if (msg.includes("readyok")) {
          this.removeHandler(handler);
          resolve();
        }
      };
      this.messageQueue.push(handler);
      this.send("isready");
    });
  }

  private removeHandler(handler: (msg: string) => void): void {
    const idx = this.messageQueue.indexOf(handler);
    if (idx !== -1) this.messageQueue.splice(idx, 1);
  }

  async evaluate(fen: string, depth: number): Promise<StockfishEvalResult> {
    await this.isReady();
    this.send("ucinewgame");
    await this.isReady();
    this.send(`position fen ${fen}`);

    return new Promise<StockfishEvalResult>((resolve) => {
      let bestEval = 0;
      let bestPV = "";
      let bestDepth = 0;
      let bestMove = "";

      const handler = (msg: string) => {
        if (msg.startsWith("info") && msg.includes("score")) {
          const depthMatch = msg.match(/depth (\d+)/);
          const scoreMatch = msg.match(/score (cp|mate) (-?\d+)/);
          const pvMatch = msg.match(/pv (.+)/);

          if (depthMatch) bestDepth = parseInt(depthMatch[1]);
          if (scoreMatch) {
            if (scoreMatch[1] === "cp") {
              bestEval = parseInt(scoreMatch[2]);
            } else {
              // mate score
              const mateIn = parseInt(scoreMatch[2]);
              bestEval = mateIn > 0 ? 30000 - mateIn : -30000 - mateIn;
            }
          }
          if (pvMatch) bestPV = pvMatch[1];
        }

        if (msg.startsWith("bestmove")) {
          bestMove = msg.split(" ")[1] || "";
          this.removeHandler(handler);
          resolve({
            bestMove,
            eval: bestEval,
            depth: bestDepth,
            pv: bestPV,
          });
        }
      };

      this.messageQueue.push(handler);
      this.send(`go depth ${depth}`);
    });
  }

  async getBestMove(fen: string, depth: number): Promise<string> {
    const result = await this.evaluate(fen, depth);
    return result.bestMove;
  }

  /**
   * Run MultiPV analysis to get the top N candidate moves with scores.
   * Returns candidates sorted best-to-worst from side-to-move's perspective.
   */
  async evaluateMultiPV(
    fen: string,
    depth: number,
    numPV: number
  ): Promise<StockfishEvalResult[]> {
    await this.isReady();
    this.send("ucinewgame");
    await this.isReady();
    this.send(`setoption name MultiPV value ${numPV}`);
    await this.isReady();
    this.send(`position fen ${fen}`);

    return new Promise<StockfishEvalResult[]>((resolve) => {
      // Track the best info line for each PV index at the target depth
      const pvResults = new Map<
        number,
        { eval: number; depth: number; pv: string; move: string }
      >();

      const handler = (msg: string) => {
        if (msg.startsWith("info") && msg.includes("score")) {
          const depthMatch = msg.match(/depth (\d+)/);
          const multipvMatch = msg.match(/multipv (\d+)/);
          const scoreMatch = msg.match(/score (cp|mate) (-?\d+)/);
          const pvMatch = msg.match(/pv (.+)/);

          if (!depthMatch || !scoreMatch || !pvMatch) return;

          const d = parseInt(depthMatch[1]);
          const pvIdx = multipvMatch ? parseInt(multipvMatch[1]) : 1;

          let evalScore: number;
          if (scoreMatch[1] === "cp") {
            evalScore = parseInt(scoreMatch[2]);
          } else {
            const mateIn = parseInt(scoreMatch[2]);
            evalScore = mateIn > 0 ? 30000 - mateIn : -30000 - mateIn;
          }

          const pvLine = pvMatch[1];
          const firstMove = pvLine.split(" ")[0] || "";

          // Only keep the highest depth for each PV line
          const existing = pvResults.get(pvIdx);
          if (!existing || d >= existing.depth) {
            pvResults.set(pvIdx, {
              eval: evalScore,
              depth: d,
              pv: pvLine,
              move: firstMove,
            });
          }
        }

        if (msg.startsWith("bestmove")) {
          this.removeHandler(handler);

          // Reset MultiPV to 1 for subsequent calls
          this.send("setoption name MultiPV value 1");

          // Build results sorted by eval (best first)
          const results: StockfishEvalResult[] = Array.from(
            pvResults.values()
          )
            .map((r) => ({
              bestMove: r.move,
              eval: r.eval,
              depth: r.depth,
              pv: r.pv,
            }))
            .sort((a, b) => b.eval - a.eval);

          resolve(results);
        }
      };

      this.messageQueue.push(handler);
      this.send(`go depth ${depth}`);
    });
  }

  setOption(name: string, value: string | number): void {
    this.send(`setoption name ${name} value ${value}`);
  }

  stop(): void {
    this.send("stop");
  }

  quit(): void {
    this.send("quit");
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
  }
}

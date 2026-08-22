import {
  preprocessMaiaPosition,
  probabilitiesForLegalMoves,
  sampleMaiaMove,
  type MovePolicy,
  type MovePolicyResult,
} from "@outprep/engine";

interface PendingInference {
  resolve: (logits: Float32Array) => void;
  reject: (error: Error) => void;
  timeout: number;
}

interface WorkerMessage {
  type: "ready" | "status" | "result" | "error";
  id?: number;
  logits?: ArrayBuffer;
  message?: string;
  status?: string;
  progress?: number;
}

export type MaiaStatus =
  | { state: "loading"; progress?: number }
  | { state: "ready" }
  | { state: "error"; message: string };

export interface MaiaMovePolicyOptions {
  selfRating: number;
  opponentRating: number;
  onStatus?: (status: MaiaStatus) => void;
  random?: () => number;
}

export function isMaiaEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MAIA_ENABLED !== "false";
}

export class MaiaMovePolicy implements MovePolicy {
  readonly id = "maia" as const;

  private readonly worker: Worker;
  private readonly selfRating: number;
  private readonly opponentRating: number;
  private readonly onStatus?: (status: MaiaStatus) => void;
  private readonly random: () => number;
  private readonly pending = new Map<number, PendingInference>();
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readyTimeout: number;
  private nextId = 1;
  private disposed = false;

  constructor(options: MaiaMovePolicyOptions) {
    if (typeof Worker === "undefined") {
      throw new Error("Web Workers are unavailable");
    }

    this.selfRating = clampRating(options.selfRating);
    this.opponentRating = clampRating(options.opponentRating);
    this.onStatus = options.onStatus;
    this.random = options.random ?? Math.random;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Initialization starts eagerly, before the first out-of-book move awaits it.
    // Mark the promise handled so an early unmount cannot emit an unhandled rejection.
    void this.ready.catch(() => {});
    this.worker = new Worker("/maia-worker.js");
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handleMessage(event.data);
    this.worker.onerror = (event) => this.fail(new Error(event.message || "Maia worker crashed"));
    this.readyTimeout = window.setTimeout(
      () => this.fail(new Error("Maia model initialization timed out")),
      120_000,
    );
    this.onStatus?.({ state: "loading" });
    this.worker.postMessage({ type: "init" });
  }

  async selectMove(fen: string): Promise<MovePolicyResult> {
    if (this.disposed) throw new Error("Maia policy has been disposed");
    await this.ready;

    const { tokens, legalMoves } = preprocessMaiaPosition(fen);
    if (legalMoves.length === 0) throw new Error("Position has no legal moves");
    const logits = await this.infer(tokens);
    const probabilities = probabilitiesForLegalMoves(logits, legalMoves);
    const selected = sampleMaiaMove(probabilities, this.random);

    return {
      uci: selected.uci,
      candidates: probabilities.slice(0, 12).map((move) => ({
        uci: move.uci,
        probability: move.probability,
      })),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.readyTimeout);
    this.worker.terminate();
    this.fail(new Error("Maia policy disposed"));
  }

  private infer(tokens: Float32Array): Promise<Float32Array> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Maia inference timed out"));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage(
        {
          type: "inference",
          id,
          tokens: tokens.buffer,
          selfRating: this.selfRating,
          opponentRating: this.opponentRating,
        },
        [tokens.buffer],
      );
    });
  }

  private handleMessage(message: WorkerMessage): void {
    if (message.type === "ready") {
      window.clearTimeout(this.readyTimeout);
      this.resolveReady();
      this.onStatus?.({ state: "ready" });
      return;
    }
    if (message.type === "status") {
      this.onStatus?.({ state: "loading", progress: message.progress });
      return;
    }
    if (message.type === "error" && message.id === undefined) {
      this.fail(new Error(message.message || "Maia initialization failed"));
      return;
    }
    if (message.id === undefined) return;

    const pending = this.pending.get(message.id);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.type === "error") {
      pending.reject(new Error(message.message || "Maia inference failed"));
    } else if (message.type === "result" && message.logits) {
      pending.resolve(new Float32Array(message.logits));
    }
  }

  private fail(error: Error): void {
    window.clearTimeout(this.readyTimeout);
    this.rejectReady(error);
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.onStatus?.({ state: "error", message: error.message });
  }
}

function clampRating(rating: number): number {
  if (!Number.isFinite(rating)) return 1500;
  return Math.max(600, Math.min(3000, Math.round(rating)));
}

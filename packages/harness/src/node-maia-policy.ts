import { readFile } from "node:fs/promises";
import * as ort from "onnxruntime-web";
import {
  preprocessMaiaPosition,
  probabilitiesForLegalMoves,
  sampleMaiaMove,
  type MovePolicy,
  type MovePolicyResult,
} from "@outprep/engine";

/** Node/WASM Maia-3 adapter for held-out harness benchmarks. */
export class NodeMaiaPolicy implements MovePolicy {
  readonly id = "maia" as const;

  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly selfRating: number,
    private readonly opponentRating: number,
  ) {}

  static async create(options: {
    modelPath: string;
    selfRating: number;
    opponentRating: number;
  }): Promise<NodeMaiaPolicy> {
    ort.env.wasm.numThreads = 1;
    const model = await readFile(options.modelPath);
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    return new NodeMaiaPolicy(
      session,
      clampRating(options.selfRating),
      clampRating(options.opponentRating),
    );
  }

  async selectMove(fen: string): Promise<MovePolicyResult> {
    const { tokens, legalMoves } = preprocessMaiaPosition(fen);
    const output = await this.session.run({
      tokens: new ort.Tensor("float32", tokens, [1, 64, 12]),
      elo_self: new ort.Tensor("float32", Float32Array.of(this.selfRating), [1]),
      elo_oppo: new ort.Tensor("float32", Float32Array.of(this.opponentRating), [1]),
    });
    const logits = output.logits_move.data;
    if (!(logits instanceof Float32Array)) {
      throw new Error("Unexpected Maia policy output type");
    }
    const probabilities = probabilitiesForLegalMoves(logits, legalMoves);
    const selected = sampleMaiaMove(probabilities);
    return {
      uci: selected.uci,
      candidates: probabilities.slice(0, 12).map((move) => ({
        uci: move.uci,
        probability: move.probability,
      })),
    };
  }
}

function clampRating(rating: number): number {
  return Math.max(600, Math.min(3000, Math.round(rating)));
}

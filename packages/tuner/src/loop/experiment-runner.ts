/**
 * Experiment runner — wraps the harness `runAccuracyTest()` for tuner use.
 *
 * Runs a single experiment (one config variant against one dataset)
 * and returns the TestResult. A single Stockfish engine instance is
 * reused across all experiments for efficiency.
 */

import {
  runAccuracyTest,
  NodeStockfishAdapter,
  type Dataset,
  type RunConfig,
  type TestResult,
} from "@outprep/harness";
import type { ExperimentSpec } from "../state/types";
import type { BotConfig } from "@outprep/engine";

/**
 * Initialize Stockfish WASM engine (reuse across experiments).
 */
export async function createEngine(): Promise<NodeStockfishAdapter> {
  const engine = new NodeStockfishAdapter();
  await engine.init();
  return engine;
}

/**
 * Run a single experiment against a single dataset.
 */
export async function runExperiment(
  engine: NodeStockfishAdapter,
  dataset: Dataset,
  spec: ExperimentSpec,
  onProgress?: (evaluated: number, total: number) => void
): Promise<TestResult> {
  const runConfig: RunConfig = {
    seed: spec.seed,
    label: spec.id,
    configOverrides: spec.configOverride as Partial<BotConfig>,
    maxPositions: spec.maxPositions ?? undefined,
  };

  const result = await runAccuracyTest(engine, dataset, runConfig, {
    onProgress,
  });

  return result;
}

/**
 * Run the baseline (no config overrides) against a dataset.
 */
export async function runBaseline(
  engine: NodeStockfishAdapter,
  dataset: Dataset,
  seed: number,
  maxPositions?: number,
  onProgress?: (evaluated: number, total: number) => void
): Promise<TestResult> {
  const runConfig: RunConfig = {
    seed,
    label: "baseline",
    maxPositions,
  };

  return runAccuracyTest(engine, dataset, runConfig, { onProgress });
}

/**
 * Experiment runner — wraps the harness `runAccuracyTest()` for tuner use.
 *
 * Runs a single experiment (one config variant against one dataset)
 * and returns the TestResult. A single Stockfish engine instance is
 * reused across all experiments for efficiency.
 *
 * Triage mode applies speed overrides (lower depth, fewer MultiPV
 * candidates) so each experiment finishes in seconds rather than minutes.
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
 * Triage-mode depth table: reduced depths for fast filtering.
 * Beginners (skill 0–6) → depth 4, intermediate (7–12) → depth 6,
 * experts/masters (13–20) → depth 8.
 *
 * Move quality is primarily controlled by Stockfish's Skill Level
 * parameter, not depth. Lower depth is sufficient for triage where
 * we only need directional signal, not precise scores.
 */
const TRIAGE_DEPTH_BY_SKILL: [number, number][] = [
  [6, 4],
  [12, 6],
  [20, 8],
];

/**
 * Build configOverrides with triage speed caps merged on top of
 * experiment-specific overrides. The experiment's tested parameter
 * always takes priority — we only inject speed caps for fields
 * the experiment is NOT testing.
 */
function buildTriageOverrides(
  expOverride: Partial<BotConfig> | undefined
): Partial<BotConfig> {
  const override = (expOverride ?? {}) as Partial<BotConfig>;
  const merged: Partial<BotConfig> = { ...override };

  // Tiered depth cap unless experiment tests depthBySkill
  if (!override.depthBySkill) {
    merged.depthBySkill = TRIAGE_DEPTH_BY_SKILL;
  }

  // Reduce multiPV to 2 unless experiment tests boltzmann.multiPvCount
  const expBoltzmann = override.boltzmann as Record<string, unknown> | undefined;
  if (!expBoltzmann || expBoltzmann.multiPvCount === undefined) {
    merged.boltzmann = {
      ...(expBoltzmann ?? {}),
      multiPvCount: 2,
    } as BotConfig["boltzmann"];
  }

  return merged;
}

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
 * Applies triage speed overrides (lower depth, fewer candidates)
 * on top of the experiment's config changes.
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
    configOverrides: buildTriageOverrides(spec.configOverride as Partial<BotConfig>),
    maxPositions: spec.maxPositions ?? undefined,
    skipTopN: true,  // triage mode: skip expensive top-N accuracy check
  };

  const result = await runAccuracyTest(engine, dataset, runConfig, {
    onProgress,
  });

  return result;
}

/**
 * Run the baseline (no config overrides) against a dataset.
 * In triage mode, applies the same speed caps as experiments
 * so baseline and experiment scores are comparable (apples-to-apples).
 */
export async function runBaseline(
  engine: NodeStockfishAdapter,
  dataset: Dataset,
  seed: number,
  maxPositions?: number,
  onProgress?: (evaluated: number, total: number) => void,
  triageMode?: boolean
): Promise<TestResult> {
  const runConfig: RunConfig = {
    seed,
    label: "baseline",
    maxPositions,
    skipTopN: triageMode ?? false,
    configOverrides: triageMode
      ? buildTriageOverrides(undefined)
      : undefined,
  };

  return runAccuracyTest(engine, dataset, runConfig, { onProgress });
}

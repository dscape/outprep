#!/usr/bin/env tsx
/**
 * Eval worker — standalone subprocess that runs harness evaluations.
 *
 * Spawned inside the sandbox worktree so that `@outprep/engine` and
 * `@outprep/harness` resolve to the sandbox's (possibly modified) copies.
 *
 * Protocol:
 *   stdin  <- JSON: EvalWorkerInput
 *   stdout -> JSON: EvalWorkerOutput
 *   stderr -> diagnostic messages (not parsed)
 *
 * The parent process writes the full input as a single JSON blob,
 * then closes stdin. The worker runs the evaluation, writes the
 * result to stdout as JSON, and exits.
 */

import {
  createBot,
  buildErrorProfileFromEvals,
  buildOpeningTrie,
  analyzeStyleFromRecords,
  type GameRecord,
  type GameEvalData,
  type ErrorProfile,
  type OpeningTrie,
  type StyleMetrics,
  type BotConfig,
} from "@outprep/engine";
import {
  runAccuracyTest,
  NodeStockfishAdapter,
  type Dataset,
  type RunConfig,
  type TestResult,
} from "@outprep/harness";

/* ── Worker protocol types ─────────────────────────────────── */

interface EvalWorkerInput {
  dataset: Dataset;
  runConfig: RunConfig;
}

interface EvalWorkerOutput {
  success: boolean;
  result?: TestResult;
  error?: string;
}

/* ── Read stdin ────────────────────────────────────────────── */

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/* ── Main ──────────────────────────────────────────────────── */

async function main(): Promise<void> {
  let engine: NodeStockfishAdapter | null = null;

  try {
    // Read input from stdin
    const raw = await readStdin();
    const input: EvalWorkerInput = JSON.parse(raw);

    // Initialize Stockfish engine
    engine = new NodeStockfishAdapter();
    await engine.init();

    // Progress reporting to stderr (so parent can optionally read it)
    const callbacks = {
      onProgress: (evaluated: number, total: number) => {
        process.stderr.write(
          `\r  eval: ${evaluated}/${total} positions`
        );
      },
    };

    // Run the harness evaluation
    const result = await runAccuracyTest(
      engine,
      input.dataset,
      input.runConfig,
      callbacks
    );

    // Write result to stdout
    const output: EvalWorkerOutput = { success: true, result };
    process.stdout.write(JSON.stringify(output));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const output: EvalWorkerOutput = { success: false, error: message };
    process.stdout.write(JSON.stringify(output));
  } finally {
    if (engine) {
      try {
        engine.dispose();
      } catch {
        // Ignore disposal errors
      }
    }
  }
}

main().then(() => process.exit(0));

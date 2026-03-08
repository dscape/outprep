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
  buildErrorProfileFromEvals,
  buildOpeningTrie,
  analyzeStyleFromRecords,
  type GameRecord,
  type GameEvalData,
  type ErrorProfile,
  type OpeningTrie,
  type StyleMetrics,
} from "@outprep/engine";
import {
  runAccuracyTest,
  NodeStockfishAdapter,
  lichessGameToGameRecord,
  lichessGameToEvalData,
  type Dataset,
  type RunConfig,
  type TestResult,
  type LichessGame,
} from "@outprep/harness";

/* ── Worker protocol types ─────────────────────────────────── */

interface EvalWorkerInput {
  dataset: Dataset;
  runConfig: RunConfig;
  /** Train games for profile building (train/test separation). */
  trainGames?: LichessGame[];
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

    // Build profile overrides from train games if provided (train/test separation)
    const runConfig = { ...input.runConfig };
    if (input.trainGames && input.trainGames.length > 0) {
      process.stderr.write(
        `\n  train/test split: profiles from ${input.trainGames.length} train games, eval on ${input.dataset.games.length} test games\n`
      );

      const trainRecords: GameRecord[] = input.trainGames
        .filter((g) => g.variant === "standard" && g.moves)
        .map((g) => lichessGameToGameRecord(g, input.dataset.username));

      const trainEvalData: GameEvalData[] = input.trainGames
        .map((g) => lichessGameToEvalData(g, input.dataset.username))
        .filter((d): d is GameEvalData => d !== null);

      const errorProfile: ErrorProfile = buildErrorProfileFromEvals(trainEvalData);
      const styleMetrics: StyleMetrics = analyzeStyleFromRecords(trainRecords);
      const whiteTrie: OpeningTrie = buildOpeningTrie(trainRecords, "white");
      const blackTrie: OpeningTrie = buildOpeningTrie(trainRecords, "black");

      runConfig.profileOverrides = {
        errorProfile,
        styleMetrics,
        whiteTrie,
        blackTrie,
      };
    }

    // Run the harness evaluation
    const result = await runAccuracyTest(
      engine,
      input.dataset,
      runConfig,
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

main().then(() => {
  // Don't use process.exit(0) — it kills the process before stdout drains,
  // truncating large JSON output (e.g., at 8192 bytes).
  process.exitCode = 0;
});

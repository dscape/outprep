/**
 * run command — loads a dataset, runs accuracy test, saves results.
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeStockfishAdapter } from "../node-stockfish";
import { runAccuracyTest } from "../runner";
import { formatMetrics, progressBar } from "../format";
import { captureVersionInfo } from "../version";
import type { Dataset, RunConfig } from "../types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASETS_DIR = join(__dirname, "../../datasets");
const RESULTS_DIR = join(__dirname, "../../results");

interface RunOptions {
  dataset: string;
  config?: string;
  seed: string;
  label?: string;
  eloOverride?: string;
  maxPositions?: string;
}

export async function run(options: RunOptions) {
  const { dataset: datasetName } = options;

  // Load dataset
  const datasetPath = existsSync(datasetName)
    ? datasetName
    : join(DATASETS_DIR, `${datasetName}.json`);

  if (!existsSync(datasetPath)) {
    console.error(`Dataset not found: ${datasetPath}`);
    console.error(
      `Run 'harness create-dataset -u <username>' to create one first.`
    );
    process.exit(1);
  }

  console.log(`\nLoading dataset: ${datasetPath}`);
  const dataset: Dataset = JSON.parse(readFileSync(datasetPath, "utf-8"));
  console.log(
    `  ${dataset.gameCount} games, ${dataset.gamesWithEvals} with evals, Elo ~${dataset.estimatedElo}`
  );

  // Parse config overrides
  let configOverrides: Record<string, unknown> | undefined;
  if (options.config) {
    try {
      configOverrides = JSON.parse(options.config);
    } catch (e) {
      console.error(`Invalid config JSON: ${options.config}`);
      process.exit(1);
    }
  }

  const runConfig: RunConfig = {
    seed: parseInt(options.seed) || 42,
    label: options.label || "unnamed",
    eloOverride: options.eloOverride
      ? parseInt(options.eloOverride)
      : undefined,
    configOverrides: configOverrides as RunConfig["configOverrides"],
    maxPositions: options.maxPositions
      ? parseInt(options.maxPositions)
      : undefined,
  };

  console.log(
    `\nRun config: seed=${runConfig.seed}, label="${runConfig.label}", elo=${runConfig.eloOverride ?? dataset.estimatedElo}`
  );
  if (runConfig.maxPositions) {
    console.log(`  Max positions: ${runConfig.maxPositions}`);
  }
  if (configOverrides) {
    console.log(`  Config overrides: ${JSON.stringify(configOverrides)}`);
  }

  // Initialize Stockfish
  console.log("\nInitializing Stockfish...");
  const engine = new NodeStockfishAdapter();
  await engine.init();
  const versionInfo = captureVersionInfo();
  console.log("Stockfish ready.");
  console.log(
    `  Engine: v${versionInfo.engineVersion} @ ${versionInfo.gitCommit}${versionInfo.gitDirty ? " (dirty)" : ""}`
  );
  console.log(`  Stockfish: ${versionInfo.stockfishVersion}\n`);

  // Run accuracy test
  let lastProgressLine = "";
  const result = await runAccuracyTest(engine, dataset, runConfig, {
    onProgress: (evaluated, total) => {
      const line = `  ${progressBar(evaluated, total)}`;
      if (line !== lastProgressLine) {
        process.stdout.write(`\r${line}`);
        lastProgressLine = line;
      }
    },
  });

  process.stdout.write("\n");

  // Print metrics
  console.log(formatMetrics(result.metrics));

  // Save results
  mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const resultFilename = `${dataset.name}-${runConfig.label}-${ts}.json`;
  const resultPath = join(RESULTS_DIR, resultFilename);
  writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(`Results saved: ${resultPath}`);

  engine.dispose();
}

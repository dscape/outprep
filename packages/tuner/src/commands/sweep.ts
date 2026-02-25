/**
 * Sweep command — run parameter experiments against all datasets.
 *
 * Strategy:
 * 1. Run baseline against all datasets (for comparison)
 * 2. Run each experiment in triage mode (--max-positions 50)
 * 3. Promote top experiments to full validation
 * 4. Save all results and update state
 */

import { getOrCreateState, saveState } from "../state/tuner-state";
import { createSweepPlan, isPlanComplete, planProgress } from "../loop/sweep-planner";
import { createEngine, runExperiment, runBaseline } from "../loop/experiment-runner";
import { averageMetrics, aggregateExperimentResults } from "../loop/result-aggregator";
import { compositeScore, formatStrength } from "../scoring/composite-score";
import { loadDataset } from "../data/dataset-manager";
import type { Dataset } from "@outprep/harness";
import type { DatasetRef, AggregatedResult } from "../state/types";

interface SweepOptions {
  maxExperiments?: string;
  triagePositions?: string;
  fullPositions?: string;
  seed?: string;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000) % 60;
  const min = Math.floor(ms / 60000) % 60;
  const hrs = Math.floor(ms / 3600000);
  if (hrs > 0) return `${hrs}h ${min}m ${sec}s`;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

/**
 * Select a representative subset of datasets for triage runs.
 * Picks low / median / high Elo to cover the full range without
 * running every experiment against every dataset.
 * Baseline still runs against ALL datasets for accurate scoring.
 */
function selectTriageDatasets(
  pairs: { ref: DatasetRef; dataset: Dataset }[]
): { ref: DatasetRef; dataset: Dataset }[] {
  if (pairs.length <= 3) return pairs;

  const sorted = [...pairs].sort((a, b) => a.ref.elo - b.ref.elo);
  return [
    sorted[0],                                 // lowest Elo
    sorted[Math.floor(sorted.length / 2)],     // median Elo
    sorted[sorted.length - 1],                 // highest Elo
  ];
}

export async function sweep(options: SweepOptions) {
  const maxExperiments = parseInt(options.maxExperiments ?? "40", 10);
  const triagePositions = parseInt(options.triagePositions ?? "50", 10);
  const fullPositions = parseInt(options.fullPositions ?? "0", 10) || undefined;
  const baseSeed = parseInt(options.seed ?? "42", 10);

  const state = getOrCreateState();

  if (state.datasets.length === 0) {
    console.error("\n  No datasets available. Run `npm run tuner -- gather` first.\n");
    return;
  }

  state.phase = "sweep";
  saveState(state);

  console.log("\n  ╔══════════════════════════════════════════╗");
  console.log("  ║          Running Parameter Sweep         ║");
  console.log("  ╚══════════════════════════════════════════╝\n");

  // Load all datasets
  const datasetPairs: { ref: DatasetRef; dataset: Dataset }[] = [];
  for (const ref of state.datasets) {
    const ds = loadDataset(ref);
    if (ds) datasetPairs.push({ ref, dataset: ds });
  }

  if (datasetPairs.length === 0) {
    console.error("  No datasets could be loaded.\n");
    state.phase = "idle";
    saveState(state);
    return;
  }

  console.log(`  Datasets: ${datasetPairs.length}`);
  console.log(`  Max experiments: ${maxExperiments}`);
  console.log(`  Triage positions: ${triagePositions}`);
  console.log(`  Full positions: ${fullPositions ?? "unlimited"}\n`);

  // Initialize engine
  console.log("  Initializing Stockfish...");
  const engine = await createEngine();
  console.log("  Stockfish ready.\n");

  try {
    // 1. Run baseline
    console.log("  ── Phase 1: Baseline ──\n");
    const baselineResults: { ref: DatasetRef; metrics: import("@outprep/harness").Metrics }[] = [];

    for (const { ref, dataset } of datasetPairs) {
      const result = await runBaseline(engine, dataset, baseSeed, triagePositions,
        (evaluated, total) => {
          const pct = total > 0 ? ((evaluated / total) * 100).toFixed(0) : "0";
          process.stdout.write(`\r  Baseline ${ref.name}: ${evaluated}/${total} positions (${pct}%)   `);
        }
      );
      baselineResults.push({ ref, metrics: result.metrics });
      const m = result.metrics;
      process.stdout.write("\r" + " ".repeat(70) + "\r");
      console.log(
        `  Baseline ${ref.name} (${ref.elo}): match=${(m.matchRate * 100).toFixed(1)}% top4=${(m.topNRate * 100).toFixed(1)}% | botCPL=${m.avgBotCPL.toFixed(1)} playerCPL=${m.avgActualCPL.toFixed(1)} → ${formatStrength(m.avgActualCPL, m.avgBotCPL)} (${m.totalPositions} pos)`
      );
    }

    const baselineAggMetrics = averageMetrics(
      baselineResults.map((r) => ({ metrics: r.metrics, weight: r.metrics.totalPositions }))
    );
    const baselineScore = compositeScore(baselineAggMetrics);

    const baselineAgg: AggregatedResult = {
      experimentId: "baseline",
      parameter: "",
      description: "BASELINE",
      configOverride: {},
      datasetMetrics: baselineResults.map((r) => ({
        dataset: r.ref.name,
        elo: r.ref.elo,
        metrics: r.metrics,
      })),
      aggregatedMetrics: baselineAggMetrics,
      compositeScore: baselineScore,
      scoreDelta: 0,
    };

    console.log(`\n  Baseline composite score: ${(baselineScore * 100).toFixed(2)}%`);
    console.log(
      `  Breakdown: match=${(baselineAggMetrics.matchRate * 100).toFixed(1)}%  top4=${(baselineAggMetrics.topNRate * 100).toFixed(1)}%  cplΔ=${baselineAggMetrics.cplDelta.toFixed(1)}  book=${(baselineAggMetrics.bookCoverage * 100).toFixed(1)}%  strength: ${formatStrength(baselineAggMetrics.avgActualCPL, baselineAggMetrics.avgBotCPL)}\n`
    );

    // 2. Create or resume sweep plan
    if (!state.currentPlan || isPlanComplete(state.currentPlan)) {
      console.log("  ── Phase 2: Creating Sweep Plan ──\n");
      state.currentPlan = createSweepPlan(state.bestConfig, state.datasets, {
        maxExperiments,
        triagePositions,
        baseSeed,
      });
      saveState(state);
      console.log(`  Generated ${state.currentPlan.experiments.length} experiments.\n`);
    } else {
      const progress = planProgress(state.currentPlan);
      console.log(`  Resuming sweep: ${progress.complete}/${progress.total} complete.\n`);
    }

    // 3. Run triage experiments (on representative subset of datasets)
    const triagePairs = selectTriageDatasets(datasetPairs);

    // Compute triage-specific baseline from only the triage subset
    // (avoids apples-to-oranges comparison with the full 16-dataset baseline)
    const triageBaselineResults = baselineResults.filter(
      (r) => triagePairs.some((tp) => tp.ref.name === r.ref.name)
    );
    const triageBaselineMetrics = averageMetrics(
      triageBaselineResults.map((r) => ({ metrics: r.metrics, weight: r.metrics.totalPositions }))
    );
    const triageBaselineScore = compositeScore(triageBaselineMetrics);

    console.log("  ── Phase 3: Triage Runs ──\n");
    console.log(
      `  Triage datasets (${triagePairs.length}/${datasetPairs.length}): ${triagePairs.map((p) => `${p.ref.name} (${p.ref.elo})`).join(", ")}`
    );
    console.log(
      `  Triage baseline: ${(triageBaselineScore * 100).toFixed(2)}%  (full baseline: ${(baselineScore * 100).toFixed(2)}%)\n`
    );
    const allResults: Map<string, AggregatedResult> = new Map();
    const triageStart = Date.now();

    let experimentIndex = 0;
    const plan = state.currentPlan!;

    for (const spec of plan.experiments) {
      if (spec.status === "complete" || spec.status === "skipped") continue;

      experimentIndex++;
      const progress = `[${experimentIndex}/${plan.experiments.length}]`;
      const expStart = Date.now();

      spec.status = "triage";
      saveState(state);

      const expResults: { ref: DatasetRef; metrics: import("@outprep/harness").Metrics }[] = [];

      for (const { ref, dataset } of triagePairs) {
        try {
          const result = await runExperiment(engine, dataset, spec,
            (evaluated, total) => {
              const pct = total > 0 ? ((evaluated / total) * 100).toFixed(0) : "0";
              process.stdout.write(`\r  ${progress} ${spec.description.slice(0, 30).padEnd(30)} ${ref.name} ${evaluated}/${total} (${pct}%)   `);
            }
          );
          expResults.push({ ref, metrics: result.metrics });
        } catch (err) {
          console.error(`\n    Error on ${ref.name}: ${err}`);
        }
      }

      if (expResults.length === 0) {
        spec.status = "skipped";
        process.stdout.write("\r" + " ".repeat(90) + "\r");
        console.log(`  ${progress} ${spec.description.slice(0, 50).padEnd(50)} SKIPPED`);
        saveState(state);
        continue;
      }

      const aggResult = aggregateExperimentResults(
        spec.id,
        spec.parameter,
        spec.description,
        spec.configOverride as Record<string, unknown>,
        expResults.map((r) => ({
          dataset: state.datasets.find((d) => d.name === r.ref.name)!,
          result: { metrics: r.metrics } as import("@outprep/harness").TestResult,
        })),
        triageBaselineScore
      );

      spec.triageScore = aggResult.compositeScore;
      spec.status = "complete";
      allResults.set(spec.id, aggResult);

      const delta = aggResult.scoreDelta;
      const indicator = delta > 0 ? "\u25B2" : delta < 0 ? "\u25BC" : "\u2500";
      const expDuration = formatDuration(Date.now() - expStart);
      process.stdout.write("\r" + " ".repeat(90) + "\r");
      console.log(
        `  ${progress} ${spec.description.slice(0, 40).padEnd(40)} ${indicator} ${(delta >= 0 ? "+" : "")}${(delta * 100).toFixed(2)}%  (${expDuration})`
      );

      saveState(state);
    }

    plan.status = "complete";
    saveState(state);

    // 4. Summary
    const results = Array.from(allResults.values());
    const improving = results.filter((r) => r.scoreDelta > 0).sort((a, b) => b.scoreDelta - a.scoreDelta);

    const triageDuration = formatDuration(Date.now() - triageStart);
    console.log(`\n  ── Sweep Complete (${triageDuration}) ──\n`);
    console.log(`  Total experiments: ${results.length}`);
    console.log(`  Improving:         ${improving.length}`);

    if (improving.length > 0) {
      console.log(`\n  Top improvements:`);
      for (const exp of improving.slice(0, 5)) {
        console.log(
          `    ${(exp.scoreDelta >= 0 ? "+" : "")}${(exp.scoreDelta * 100).toFixed(2)}%  ${exp.description}`
        );
      }
    }

    // Save aggregated results for analyze phase
    const sweepResults = {
      baseline: baselineAgg,
      experiments: results,
      timestamp: new Date().toISOString(),
    };

    const { writeFileSync, mkdirSync, existsSync } = await import("fs");
    const { join } = await import("path");
    const { getTunerRoot } = await import("../state/tuner-state");
    const resultsDir = join(getTunerRoot(), "experiments", "results");
    if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
    const resultsPath = join(resultsDir, `sweep-cycle-${state.cycle}.json`);
    writeFileSync(resultsPath, JSON.stringify(sweepResults, null, 2));

    state.phase = "idle";
    saveState(state);

    console.log(`\n  Results saved to: ${resultsPath}`);
    console.log(`  Run \`npm run tuner -- analyze\` to generate proposal.\n`);
  } finally {
    engine.dispose();
  }
}

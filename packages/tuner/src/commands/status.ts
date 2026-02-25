/**
 * Status command — print current tuner state and progress.
 */

import { loadState } from "../state/tuner-state";
import { planProgress } from "../loop/sweep-planner";
import { formatScore } from "../scoring/composite-score";
import { ELO_BANDS } from "../state/types";

export async function status() {
  const state = loadState();

  if (!state) {
    console.log("\n  No tuning state found. Run `npm run tuner -- start` to begin.\n");
    return;
  }

  console.log("\n  ╔══════════════════════════════════════════╗");
  console.log("  ║          Outprep Tuner Status            ║");
  console.log("  ╚══════════════════════════════════════════╝\n");

  console.log(`  Cycle:           ${state.cycle}`);
  console.log(`  Phase:           ${state.phase}`);
  console.log(`  Last checkpoint: ${new Date(state.lastCheckpoint).toLocaleString()}`);
  console.log();

  // Player pool
  console.log(`  Player Pool (${state.playerPool.length} players):`);
  for (const [band, config] of Object.entries(ELO_BANDS)) {
    const players = state.playerPool.filter((p) => p.band === band);
    const status = players.length >= config.targetPlayers ? "✓" : "○";
    console.log(
      `    ${status} ${band.padEnd(14)} ${players.length}/${config.targetPlayers} players`
    );
  }
  console.log();

  // Datasets
  console.log(`  Datasets: ${state.datasets.length}`);
  for (const ds of state.datasets) {
    console.log(
      `    ${ds.name.padEnd(24)} Elo ${String(ds.elo).padStart(4)}  ${ds.gameCount} games  [${ds.band}]`
    );
  }
  console.log();

  // Sweep progress
  if (state.currentPlan) {
    const progress = planProgress(state.currentPlan);
    console.log(`  Sweep Progress:`);
    console.log(`    Total experiments:  ${progress.total}`);
    console.log(`    Complete:           ${progress.complete}`);
    console.log(`    Running:            ${progress.running}`);
    console.log(`    Pending:            ${progress.pending}`);
    console.log(`    Skipped:            ${progress.skipped}`);
    console.log();
  }

  // History
  if (state.completedCycles.length > 0) {
    console.log(`  Completed Cycles: ${state.completedCycles.length}`);
    for (const cycle of state.completedCycles.slice(-5)) {
      const status = cycle.accepted ? "✓ accepted" : "✗ rejected";
      console.log(
        `    Cycle ${cycle.cycle}: ${status} — ${cycle.experimentsRun} experiments, best Δ ${(cycle.bestScoreDelta * 100).toFixed(2)}%`
      );
    }
    console.log();
  }

  // Accepted changes
  if (state.acceptedChanges.length > 0) {
    console.log(`  Accepted Changes (${state.acceptedChanges.length}):`);
    for (const change of state.acceptedChanges) {
      console.log(
        `    ${change.path}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`
      );
    }
    console.log();
  }
}

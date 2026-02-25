/**
 * History command — print all past tuning cycles and accepted changes.
 */

import { loadState } from "../state/tuner-state";
import { formatDelta } from "../scoring/composite-score";

export async function history() {
  const state = loadState();

  if (!state) {
    console.log("\n  No tuning state found. Run `npm run tuner -- start` to begin.\n");
    return;
  }

  if (state.completedCycles.length === 0) {
    console.log("\n  No completed cycles yet.\n");
    return;
  }

  console.log("\n  ╔══════════════════════════════════════════╗");
  console.log("  ║          Tuning Cycle History            ║");
  console.log("  ╚══════════════════════════════════════════╝\n");

  for (const cycle of state.completedCycles) {
    const status = cycle.accepted ? "✓ ACCEPTED" : "✗ REJECTED";
    const date = new Date(cycle.timestamp).toLocaleString();

    const baselineStr = cycle.baselineScore != null
      ? `  |  Baseline: ${(cycle.baselineScore * 100).toFixed(2)}%`
      : "";
    console.log(`  ── Cycle ${cycle.cycle} (${date}) ── ${status}`);
    console.log(`     Datasets: ${cycle.datasetsUsed}  |  Experiments: ${cycle.experimentsRun}  |  Best Δ: ${formatDelta(cycle.bestScoreDelta)}${baselineStr}`);

    if (cycle.configChanges.length > 0) {
      console.log(`     Changes:`);
      for (const change of cycle.configChanges) {
        console.log(
          `       ${change.path}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)} (${formatDelta(change.scoreDelta)})`
        );
      }
    }
    console.log();
  }

  // Summary
  const accepted = state.completedCycles.filter((c) => c.accepted);
  const totalChanges = state.acceptedChanges.length;
  console.log(`  Summary: ${accepted.length}/${state.completedCycles.length} cycles accepted, ${totalChanges} config changes applied.\n`);
}

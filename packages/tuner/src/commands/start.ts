/**
 * Start command — run a full tuning cycle:
 * gather → sweep → analyze → proposal (pause for review).
 *
 * Resumes from wherever the state machine left off.
 */

import { getOrCreateState, saveState, createInitialState } from "../state/tuner-state";
import { gather } from "./gather";
import { sweep } from "./sweep";
import { analyze } from "./analyze";

interface StartOptions {
  skipGather?: boolean;
  forceGather?: boolean;
  maxExperiments?: string;
  triagePositions?: string;
  fullPositions?: string;
  seed?: string;
}

export async function start(options: StartOptions) {
  const state = getOrCreateState();

  console.log("\n  ╔══════════════════════════════════════════╗");
  console.log("  ║      Outprep Autonomous Tuner            ║");
  console.log("  ╚══════════════════════════════════════════╝\n");

  console.log(`  Cycle:  ${state.cycle}`);
  console.log(`  Phase:  ${state.phase}`);
  console.log();

  // If waiting for human review, remind them
  if (state.phase === "waiting") {
    console.log("  A proposal is pending review.");
    console.log("  Run `npm run tuner -- accept` or `npm run tuner -- reject` first.\n");
    return;
  }

  // --force-gather: reset player pool to current SEED_PLAYERS and clear datasets
  if (options.forceGather) {
    console.log("  Force-gathering: resetting player pool and datasets...\n");
    const freshState = createInitialState();
    state.playerPool = freshState.playerPool;
    state.datasets = [];
    state.currentPlan = null;
    state.phase = "idle";
  }

  saveState(state);

  // Phase 1: Gather (skip if --skip-gather or datasets already exist)
  if (state.phase === "idle" || state.phase === "gather") {
    if (options.skipGather && state.datasets.length > 0) {
      console.log("  Skipping gather (--skip-gather, using existing datasets).\n");
    } else if (state.datasets.length > 0 && state.phase !== "gather" && !options.forceGather) {
      console.log(`  Using ${state.datasets.length} existing datasets. Pass --force-gather to refresh.\n`);
    } else {
      await gather({ maxGames: "100", speeds: "blitz,rapid" });

      // Reload state after gather
      const updated = getOrCreateState();
      if (updated.datasets.length === 0) {
        console.error("  Gather produced no datasets. Cannot proceed.\n");
        return;
      }
    }
  }

  // Phase 2: Sweep
  if (state.phase === "idle" || state.phase === "sweep") {
    await sweep({
      maxExperiments: options.maxExperiments ?? "25",
      triagePositions: options.triagePositions ?? "30",
      fullPositions: options.fullPositions ?? "0",
      seed: options.seed ?? "42",
    });
  }

  // Phase 3: Analyze
  if (state.phase === "idle" || state.phase === "analyze") {
    await analyze();
  }

  // At this point, state.phase should be "waiting"
  // The analyze command prints next-step instructions
}

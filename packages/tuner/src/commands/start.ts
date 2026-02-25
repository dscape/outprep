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

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000) % 60;
  const min = Math.floor(ms / 60000) % 60;
  const hrs = Math.floor(ms / 3600000);
  if (hrs > 0) return `${hrs}h ${min}m ${sec}s`;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

function timestamp(): string {
  return new Date().toLocaleTimeString();
}

export async function start(options: StartOptions) {
  const state = getOrCreateState();
  const cycleStart = Date.now();

  console.log("\n  ╔══════════════════════════════════════════╗");
  console.log("  ║      Outprep Autonomous Tuner            ║");
  console.log("  ╚══════════════════════════════════════════╝\n");

  console.log(`  Cycle:  ${state.cycle}`);
  console.log(`  Phase:  ${state.phase}`);
  console.log(`  Started: ${timestamp()}`);
  console.log();

  // If waiting for human review, remind them
  if (state.phase === "waiting") {
    console.log("  A proposal is pending review.");
    console.log("  Run `npm run tuner -- accept` or `npm run tuner -- reject` first.\n");
    return;
  }

  // Auto-detect if seed players are missing from the saved pool
  const freshState = createInitialState();
  const savedUsernames = new Set(state.playerPool.map((p) => p.username.toLowerCase()));
  const missingSeedPlayers = freshState.playerPool.filter(
    (p) => !savedUsernames.has(p.username.toLowerCase())
  );

  if (missingSeedPlayers.length > 0 || options.forceGather) {
    if (missingSeedPlayers.length > 0) {
      console.log(`  Auto-resetting: ${missingSeedPlayers.length} seed players missing from saved state.`);
      console.log(`  Missing: ${missingSeedPlayers.map((p) => p.username).join(", ")}\n`);
    } else {
      console.log("  Force-gathering: resetting player pool and datasets...\n");
    }
    state.playerPool = freshState.playerPool;
    state.datasets = [];
    state.currentPlan = null;
    state.phase = "idle";
  }

  // Reset incomplete sweep plans so they pick up config/position changes
  if (state.currentPlan && state.currentPlan.status !== "complete") {
    console.log("  Resetting incomplete sweep plan to pick up config changes.\n");
    state.currentPlan = null;
  }

  saveState(state);

  // Phase 1: Gather (skip if --skip-gather or datasets already exist)
  if (state.phase === "idle" || state.phase === "gather") {
    if (options.skipGather && state.datasets.length > 0) {
      console.log("  Skipping gather (--skip-gather, using existing datasets).\n");
    } else if (state.datasets.length > 0 && state.phase !== "gather" && !options.forceGather) {
      console.log(`  Using ${state.datasets.length} existing datasets. Pass --force-gather to refresh.\n`);
    } else {
      const gatherStart = Date.now();
      console.log(`  [${timestamp()}] Starting gather phase...`);
      await gather({ maxGames: "100", speeds: "blitz,rapid" });
      console.log(`  [${timestamp()}] Gather complete (${formatDuration(Date.now() - gatherStart)})\n`);

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
    const sweepStart = Date.now();
    console.log(`  [${timestamp()}] Starting sweep phase...`);
    await sweep({
      maxExperiments: options.maxExperiments ?? "25",
      triagePositions: options.triagePositions ?? "10",
      fullPositions: options.fullPositions ?? "0",
      seed: options.seed ?? "42",
    });
    console.log(`  [${timestamp()}] Sweep complete (${formatDuration(Date.now() - sweepStart)})\n`);
  }

  // Phase 3: Analyze
  if (state.phase === "idle" || state.phase === "analyze") {
    const analyzeStart = Date.now();
    console.log(`  [${timestamp()}] Starting analysis phase...`);
    await analyze();
    console.log(`  [${timestamp()}] Analysis complete (${formatDuration(Date.now() - analyzeStart)})\n`);
  }

  // Print total duration
  console.log(`  Total cycle duration: ${formatDuration(Date.now() - cycleStart)}\n`);
}

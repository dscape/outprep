/**
 * Reject command — reject the current proposal and archive it.
 */

import { existsSync, readdirSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import { getOrCreateState, saveState, getTunerRoot } from "../state/tuner-state";
import type { CycleRecord, Proposal } from "../state/types";
import { readFileSync } from "fs";

export async function reject() {
  const state = getOrCreateState();

  if (state.phase !== "waiting") {
    console.log(`\n  No pending proposal. Current phase: ${state.phase}`);
    console.log(`  Run a full cycle first: npm run tuner -- start\n`);
    return;
  }

  const proposalsDir = join(getTunerRoot(), "proposals");
  if (!existsSync(proposalsDir)) {
    console.error("\n  No proposals found.\n");
    return;
  }

  const dirs = readdirSync(proposalsDir)
    .filter((d) => !d.startsWith("rejected-"))
    .sort()
    .reverse();

  if (dirs.length === 0) {
    console.error("\n  No proposals found.\n");
    return;
  }

  const latestDir = dirs[0];
  const latestPath = join(proposalsDir, latestDir);
  const proposalPath = join(latestPath, "proposal.json");

  let proposal: Proposal | null = null;
  if (existsSync(proposalPath)) {
    proposal = JSON.parse(readFileSync(proposalPath, "utf-8")) as Proposal;
  }

  // Archive by renaming
  const archivedName = `rejected-${latestDir}`;
  const archivedPath = join(proposalsDir, archivedName);
  renameSync(latestPath, archivedPath);

  console.log(`\n  Proposal rejected and archived to: proposals/${archivedName}`);

  // Record cycle
  state.completedCycles.push({
    cycle: state.cycle,
    timestamp: new Date().toISOString(),
    datasetsUsed: state.datasets.length,
    experimentsRun: proposal?.rankedExperiments.length ?? 0,
    bestScoreDelta: proposal?.rankedExperiments[0]?.scoreDelta ?? 0,
    accepted: false,
    configChanges: [],
  });

  state.currentPlan = null;
  state.cycle++;
  state.phase = "idle";
  saveState(state);

  console.log(`  Cycle ${state.cycle - 1} rejected. Config unchanged.`);
  console.log(`  Run \`npm run tuner -- start\` to begin the next cycle.\n`);
}

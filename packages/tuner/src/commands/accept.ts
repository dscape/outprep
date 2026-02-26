/**
 * Accept command — apply the current proposal's config changes
 * to packages/engine/src/config.ts (DEFAULT_CONFIG).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { getOrCreateState, saveState, getTunerRoot } from "../state/tuner-state";
import type { Proposal } from "../state/types";
import { DEFAULT_CONFIG, mergeConfig, type BotConfig } from "@outprep/engine";

export async function accept() {
  const state = getOrCreateState();

  if (state.phase !== "waiting") {
    console.log(`\n  No pending proposal. Current phase: ${state.phase}`);
    console.log(`  Run a full cycle first: npm run tuner -- start\n`);
    return;
  }

  // Find the most recent proposal
  const proposalsDir = join(getTunerRoot(), "proposals");
  if (!existsSync(proposalsDir)) {
    console.error("\n  No proposals found.\n");
    return;
  }

  const dirs = readdirSync(proposalsDir).sort().reverse();
  if (dirs.length === 0) {
    console.error("\n  No proposals found.\n");
    return;
  }

  const latestDir = join(proposalsDir, dirs[0]);
  const proposalPath = join(latestDir, "proposal.json");

  if (!existsSync(proposalPath)) {
    console.error(`\n  No proposal.json in ${latestDir}\n`);
    return;
  }

  const proposal = JSON.parse(readFileSync(proposalPath, "utf-8")) as Proposal;

  console.log("\n  ╔══════════════════════════════════════════╗");
  console.log("  ║          Accepting Proposal              ║");
  console.log("  ╚══════════════════════════════════════════╝\n");

  if (proposal.configChanges.length === 0) {
    console.log("  No config changes to apply.\n");
    state.phase = "idle";
    state.cycle++;
    state.completedCycles.push({
      cycle: proposal.cycle,
      timestamp: proposal.timestamp,
      datasetsUsed: state.datasets.length,
      experimentsRun: proposal.rankedExperiments.length,
      bestScoreDelta: proposal.rankedExperiments[0]?.scoreDelta ?? 0,
      accepted: true,
      configChanges: [],
      baselineScore: proposal.baselineScore,
      baselineMetrics: proposal.baselineMetrics,
      baselineDatasetMetrics: proposal.baselineDatasetMetrics,
    });
    saveState(state);
    console.log("  Cycle recorded. Ready for next cycle.\n");
    return;
  }

  // Apply changes to bestConfig in state.
  // IMPORTANT: merge over DEFAULT_CONFIG to ensure all fields are present.
  // Without this, fields like moveStyle, complexityDepth, temperatureBySkill
  // would be lost if proposal.proposedConfig doesn't include them.
  const newConfig = mergeConfig(DEFAULT_CONFIG, proposal.proposedConfig as Partial<BotConfig>);

  console.log("  Applying config changes:\n");
  for (const change of proposal.configChanges) {
    console.log(
      `    ${change.path}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`
    );
  }

  // Update engine/src/config.ts
  const configPath = join(getTunerRoot(), "..", "engine", "src", "config.ts");

  if (existsSync(configPath)) {
    console.log(`\n  Updating ${configPath}...`);

    const configSrc = readFileSync(configPath, "utf-8");

    // Replace the DEFAULT_CONFIG object literal
    // Find the section between "export const DEFAULT_CONFIG: BotConfig = {" and the closing "};"
    const configStart = configSrc.indexOf("export const DEFAULT_CONFIG: BotConfig = ");
    if (configStart === -1) {
      console.error("  Could not find DEFAULT_CONFIG in config.ts. Skipping file update.");
      console.log("  The proposed config is saved in proposal.json for manual application.\n");
    } else {
      // Generate new config source from the proposed config
      const beforeConfig = configSrc.slice(0, configStart);
      const newConfigSrc = generateConfigSource(newConfig);
      const updatedSrc = beforeConfig + newConfigSrc;

      writeFileSync(configPath, updatedSrc);
      console.log("  DEFAULT_CONFIG updated successfully.");
    }
  }

  // Update state
  state.bestConfig = newConfig;
  state.acceptedChanges.push(...proposal.configChanges);
  state.completedCycles.push({
    cycle: proposal.cycle,
    timestamp: proposal.timestamp,
    datasetsUsed: state.datasets.length,
    experimentsRun: proposal.rankedExperiments.length,
    bestScoreDelta: proposal.rankedExperiments[0]?.scoreDelta ?? 0,
    accepted: true,
    configChanges: proposal.configChanges,
    baselineScore: proposal.baselineScore,
    baselineMetrics: proposal.baselineMetrics,
    baselineDatasetMetrics: proposal.baselineDatasetMetrics,
  });
  state.currentPlan = null;
  state.cycle++;
  state.phase = "idle";
  saveState(state);

  console.log(`\n  Cycle ${state.cycle - 1} accepted. Ready for next cycle.`);
  console.log(`  Run \`npm run tuner -- start\` to begin the next cycle.\n`);
}

function generateConfigSource(config: BotConfig): string {
  // Pretty-print with unquoted keys for readability
  const json = JSON.stringify(config, null, 2).replace(/"([^"]+)":/g, "$1:");
  return `export const DEFAULT_CONFIG: BotConfig = ${json};
`;
}

/**
 * Gather command — fetch datasets from Lichess players across Elo bands.
 */

import { getOrCreateState, saveState } from "../state/tuner-state";
import { validatePool } from "../data/player-pool";
import { createAllDatasets } from "../data/dataset-manager";

interface GatherOptions {
  maxGames?: string;
  speeds?: string;
}

export async function gather(options: GatherOptions) {
  const maxGames = parseInt(options.maxGames ?? "100", 10);
  const speeds = options.speeds ?? "blitz,rapid";

  const state = getOrCreateState();
  state.phase = "gather";
  saveState(state);

  console.log("\n  ╔══════════════════════════════════════════╗");
  console.log("  ║          Gathering Datasets              ║");
  console.log("  ╚══════════════════════════════════════════╝\n");

  // 1. Validate player pool
  console.log(`  Validating ${state.playerPool.length} players in pool...\n`);
  const validPlayers = await validatePool(state.playerPool, (done, total) => {
    process.stdout.write(`\r  Validating players: ${done}/${total}`);
  });
  console.log(`\n  ${validPlayers.length} valid players found.\n`);

  state.playerPool = validPlayers;
  saveState(state);

  if (validPlayers.length === 0) {
    console.error("  No valid players in pool. Add players manually to tuner-state.json.\n");
    state.phase = "idle";
    saveState(state);
    return;
  }

  // 2. Create datasets
  console.log(`  Creating datasets (${maxGames} games per player, speeds: ${speeds})...\n`);
  const datasets = await createAllDatasets(validPlayers, { maxGames, speeds });

  state.datasets = datasets;
  state.phase = "idle";
  saveState(state);

  console.log(`\n  Gathered ${datasets.length} datasets across ${new Set(datasets.map((d) => d.band)).size} Elo bands.`);
  for (const ds of datasets) {
    console.log(
      `    ${ds.name.padEnd(24)} Elo ${String(ds.elo).padStart(4)}  ${ds.gameCount} games  [${ds.band}]`
    );
  }
  console.log(`\n  Run \`npm run tuner -- sweep\` to start experiments.\n`);
}

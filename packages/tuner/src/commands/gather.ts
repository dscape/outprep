/**
 * Gather command — fetch datasets from Lichess players across Elo bands.
 *
 * After validating and fetching seed players, runs opponent discovery
 * to fill any under-represented Elo bands automatically.
 */

import { getOrCreateState, saveState } from "../state/tuner-state";
import { validatePool, validatePlayer, getBandsNeedingPlayers } from "../data/player-pool";
import { createAllDatasets, createDatasetForPlayer, loadDataset } from "../data/dataset-manager";
import { extractAllOpponents, pickOpponentsForBands } from "../data/player-discovery";
import type { LichessGame } from "@outprep/harness";

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

  // 2. Create datasets for seed players
  console.log(`  Creating datasets (${maxGames} games per player, speeds: ${speeds})...\n`);
  const datasets = await createAllDatasets(validPlayers, { maxGames, speeds });

  // 3. Opponent discovery — fill under-represented bands
  const bandsNeeded = getBandsNeedingPlayers(state.playerPool);
  if (bandsNeeded.length > 0 && datasets.length > 0) {
    console.log(
      `\n  Discovering opponents for: ${bandsNeeded.map((b) => `${b.band} (need ${b.needed})`).join(", ")}...`
    );

    // Collect all games from existing datasets
    const gamesByPlayer: { username: string; games: LichessGame[] }[] = [];
    for (const ref of datasets) {
      const ds = loadDataset(ref);
      if (ds) gamesByPlayer.push({ username: ds.username, games: ds.games });
    }

    const excludeSet = new Set(
      state.playerPool.map((p) => p.username.toLowerCase())
    );
    const opponents = extractAllOpponents(gamesByPlayer, excludeSet);
    const discovered = pickOpponentsForBands(opponents, state.playerPool);

    if (discovered.length > 0) {
      console.log(`  Found ${discovered.length} opponents to fill gaps.\n`);

      for (const player of discovered) {
        const validated = await validatePlayer(player);
        if (validated) {
          state.playerPool.push(validated);
          const ref = await createDatasetForPlayer(validated, { maxGames, speeds });
          if (ref) datasets.push(ref);
          console.log(
            `    + ${validated.username} (Elo ${validated.estimatedElo}, ${validated.band})`
          );
        }
        // Rate limit between Lichess API calls
        await new Promise((r) => setTimeout(r, 1500));
      }
    } else {
      console.log("  No suitable opponents found for missing bands.\n");
    }
  }

  state.datasets = datasets;
  state.phase = "idle";
  saveState(state);

  console.log(
    `\n  Gathered ${datasets.length} datasets across ${new Set(datasets.map((d) => d.band)).size} Elo bands.`
  );
  for (const ds of datasets) {
    console.log(
      `    ${ds.name.padEnd(24)} Elo ${String(ds.elo).padStart(4)}  ${ds.gameCount} games  [${ds.band}]`
    );
  }
  console.log(`\n  Run \`npm run tuner -- sweep\` to start experiments.\n`);
}

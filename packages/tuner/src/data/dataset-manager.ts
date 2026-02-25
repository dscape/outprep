/**
 * Dataset manager — batch creation and loading of test datasets.
 *
 * Wraps the harness Lichess fetch to create datasets for each player
 * in the pool. Stores datasets in packages/tuner/experiments/datasets/.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { fetchLichessGames, fetchLichessUser } from "@outprep/harness";
import type { Dataset } from "@outprep/harness";
import type { PlayerEntry, DatasetRef } from "../state/types";
import { classifyEloBand } from "./player-pool";
import { getTunerRoot } from "../state/tuner-state";

const DATASETS_DIR = join(getTunerRoot(), "experiments", "datasets");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Create a dataset for a player, or return existing if fresh enough.
 */
export async function createDatasetForPlayer(
  player: PlayerEntry,
  options: { maxGames?: number; speeds?: string } = {}
): Promise<DatasetRef | null> {
  ensureDir(DATASETS_DIR);

  const maxGames = options.maxGames ?? 100;
  const speeds = options.speeds ?? "blitz,rapid";
  const datasetPath = join(DATASETS_DIR, `${player.username}.json`);

  // If dataset exists and is less than 7 days old, reuse it
  if (existsSync(datasetPath)) {
    try {
      const existing = JSON.parse(readFileSync(datasetPath, "utf-8")) as Dataset;
      const age = Date.now() - new Date(existing.createdAt).getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (age < sevenDays) {
        console.log(`  Reusing cached dataset for ${player.username} (${existing.gameCount} games)`);
        return {
          name: player.username,
          username: existing.username,
          band: player.band,
          elo: existing.estimatedElo,
          gameCount: existing.gameCount,
          path: datasetPath,
        };
      }
    } catch {
      // Corrupted file, re-fetch
    }
  }

  console.log(`  Fetching games for ${player.username} (max ${maxGames}, ${speeds})...`);

  try {
    // Validate user exists
    const user = await fetchLichessUser(player.username);
    if (!user) {
      console.log(`  Player ${player.username} not found on Lichess, skipping.`);
      return null;
    }

    // Rate limit between API calls
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Fetch games
    const speedList = speeds.split(",").map((s) => s.trim());
    const games = await fetchLichessGames(player.username, maxGames, speedList);

    if (!games || games.length === 0) {
      console.log(`  No games found for ${player.username}, skipping.`);
      return null;
    }

    // Filter to standard games with moves
    const standardGames = games.filter(
      (g) => g.variant === "standard" && g.moves
    );
    const gamesWithEvals = standardGames.filter(
      (g) => g.analysis && g.analysis.length > 0
    );

    // Estimate Elo from game ratings
    const ratings: number[] = [];
    for (const g of standardGames) {
      const isWhite =
        g.players.white?.user?.id?.toLowerCase() ===
        user.id.toLowerCase();
      const rating = isWhite
        ? g.players.white?.rating
        : g.players.black?.rating;
      if (rating) ratings.push(rating);
    }
    const estimatedElo =
      ratings.length > 0
        ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length)
        : player.estimatedElo;

    const dataset: Dataset = {
      name: player.username,
      username: user.id,
      estimatedElo,
      speeds: speedList,
      createdAt: new Date().toISOString(),
      gameCount: standardGames.length,
      gamesWithEvals: gamesWithEvals.length,
      games: standardGames,
    };

    writeFileSync(datasetPath, JSON.stringify(dataset, null, 2));
    console.log(
      `  Saved ${standardGames.length} games (${gamesWithEvals.length} with evals) for ${player.username}`
    );

    return {
      name: player.username,
      username: user.id,
      band: classifyEloBand(estimatedElo),
      elo: estimatedElo,
      gameCount: standardGames.length,
      path: datasetPath,
    };
  } catch (err) {
    console.error(`  Error fetching games for ${player.username}:`, err);
    return null;
  }
}

/**
 * Load a dataset from disk.
 */
export function loadDataset(ref: DatasetRef): Dataset | null {
  try {
    const raw = readFileSync(ref.path, "utf-8");
    return JSON.parse(raw) as Dataset;
  } catch {
    console.error(`  Failed to load dataset: ${ref.path}`);
    return null;
  }
}

/**
 * Create datasets for all players in the pool.
 */
export async function createAllDatasets(
  players: PlayerEntry[],
  options: { maxGames?: number; speeds?: string } = {}
): Promise<DatasetRef[]> {
  const refs: DatasetRef[] = [];

  for (const player of players) {
    const ref = await createDatasetForPlayer(player, options);
    if (ref) refs.push(ref);

    // Rate limit between players
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return refs;
}

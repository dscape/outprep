/**
 * create-dataset command — fetches games from Lichess and saves as a dataset.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchLichessGames, fetchLichessUser } from "../lichess-fetch";
import type { Dataset } from "../types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASETS_DIR = join(__dirname, "../../datasets");

interface CreateDatasetOptions {
  username: string;
  maxGames: string;
  speeds: string;
  output?: string;
}

export async function createDataset(options: CreateDatasetOptions) {
  const { username } = options;
  const maxGames = parseInt(options.maxGames) || 200;
  const speeds = options.speeds
    ? options.speeds.split(",").map((s) => s.trim())
    : [];
  const name = options.output || username;

  console.log(`\nFetching up to ${maxGames} games for ${username}...`);
  if (speeds.length > 0) {
    console.log(`  Speeds: ${speeds.join(", ")}`);
  }

  // Fetch user info for Elo estimation
  const user = await fetchLichessUser(username);
  console.log(`  User: ${user.username}`);

  // Fetch games
  const games = await fetchLichessGames(
    username,
    maxGames,
    speeds.length > 0 ? speeds : undefined
  );
  console.log(`  Fetched ${games.length} games.`);

  // Filter to standard variant
  const standardGames = games.filter(
    (g) => g.variant === "standard" && g.moves
  );
  console.log(`  Standard games with moves: ${standardGames.length}`);

  // Count games with eval annotations
  const gamesWithEvals = standardGames.filter(
    (g) => g.analysis && g.analysis.length > 0
  ).length;
  console.log(`  Games with Lichess evals: ${gamesWithEvals}`);

  // Estimate Elo from game ratings
  const ratings: number[] = [];
  for (const game of standardGames) {
    const isWhite =
      game.players.white?.user?.id?.toLowerCase() === username.toLowerCase();
    const rating = isWhite
      ? game.players.white?.rating
      : game.players.black?.rating;
    if (rating) ratings.push(rating);
  }
  const estimatedElo =
    ratings.length > 0
      ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length)
      : 1500;
  console.log(`  Estimated Elo: ${estimatedElo}`);

  // Save dataset
  const dataset: Dataset = {
    name,
    username: user.id, // use canonical id (lowercase)
    estimatedElo,
    speeds,
    createdAt: new Date().toISOString(),
    gameCount: standardGames.length,
    gamesWithEvals,
    games: standardGames,
  };

  mkdirSync(DATASETS_DIR, { recursive: true });
  const outPath = join(DATASETS_DIR, `${name}.json`);
  writeFileSync(outPath, JSON.stringify(dataset, null, 2));
  console.log(`\nDataset saved: ${outPath}`);
  console.log(
    `  ${dataset.gameCount} games, ${dataset.gamesWithEvals} with evals.`
  );
}

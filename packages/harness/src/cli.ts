#!/usr/bin/env node

/**
 * Outprep harness CLI — accuracy testing for the chess bot engine.
 */

import { Command } from "commander";
import { createDataset } from "./commands/create-dataset";
import { run } from "./commands/run";
import { compare } from "./commands/compare";

const program = new Command()
  .name("harness")
  .description("Outprep engine accuracy test harness")
  .version("0.1.0");

program
  .command("create-dataset")
  .description("Fetch games from Lichess and create a test dataset")
  .requiredOption("-u, --username <username>", "Lichess username")
  .option("-n, --max-games <n>", "Maximum games to fetch", "200")
  .option(
    "-s, --speeds <speeds>",
    "Comma-separated speeds (bullet,blitz,rapid,classical)",
    "blitz,rapid"
  )
  .option("-o, --output <name>", "Dataset name (default: username)")
  .action(createDataset);

program
  .command("run")
  .description("Run accuracy test on a dataset")
  .requiredOption("-d, --dataset <name>", "Dataset name or path")
  .option("-c, --config <json>", "BotConfig overrides as JSON string")
  .option("--seed <n>", "Random seed for reproducibility", "42")
  .option("--label <label>", "Human-readable label for this run", "unnamed")
  .option("--elo-override <n>", "Override the player Elo for bot creation")
  .option("--max-positions <n>", "Cap number of positions to evaluate")
  .action(run);

program
  .command("compare")
  .description("Compare two or more test results")
  .argument("<results...>", "Result file names, paths, or labels")
  .action(compare);

program.parse();

#!/usr/bin/env node

/**
 * Outprep tuner CLI — autonomous engine accuracy improvement agent.
 *
 * Orchestrates: gather data → sweep configs → analyze → propose changes.
 */

import { Command } from "commander";
import { start } from "./commands/start";
import { gather } from "./commands/gather";
import { sweep } from "./commands/sweep";
import { analyze } from "./commands/analyze";
import { accept } from "./commands/accept";
import { reject } from "./commands/reject";
import { status } from "./commands/status";
import { history } from "./commands/history";

const program = new Command()
  .name("tuner")
  .description("Autonomous engine accuracy improvement agent")
  .version("0.1.0");

program
  .command("start")
  .description("Run a full tuning cycle (gather → sweep → analyze → proposal)")
  .option("--skip-gather", "Skip data gathering (reuse existing datasets)")
  .option("--max-experiments <n>", "Cap number of experiments per sweep", "40")
  .option("--triage-positions <n>", "Positions for triage runs", "50")
  .option("--full-positions <n>", "Positions for full validation runs (0 = unlimited)", "0")
  .option("--seed <n>", "Base random seed", "42")
  .action(start);

program
  .command("gather")
  .description("Fetch datasets from Lichess players (Elo-stratified)")
  .option("--max-games <n>", "Games per player", "100")
  .option("--speeds <list>", "Comma-separated speed filters", "blitz,rapid")
  .action(gather);

program
  .command("sweep")
  .description("Run parameter sweep experiments")
  .option("--max-experiments <n>", "Cap total experiments", "40")
  .option("--triage-positions <n>", "Positions for triage runs", "50")
  .option("--full-positions <n>", "Positions for full validation (0 = unlimited)", "0")
  .option("--seed <n>", "Base random seed", "42")
  .action(sweep);

program
  .command("analyze")
  .description("Analyze sweep results and generate proposal")
  .action(analyze);

program
  .command("accept")
  .description("Accept the current proposal and update DEFAULT_CONFIG")
  .action(accept);

program
  .command("reject")
  .description("Reject the current proposal and archive it")
  .action(reject);

program
  .command("status")
  .description("Print current tuner state and progress")
  .action(status);

program
  .command("history")
  .description("Print history of tuning cycles and accepted changes")
  .action(history);

// ── API key gate ──────────────────────────────────────────────
// All commands except status/history require ANTHROPIC_API_KEY.
const EXEMPT_COMMANDS = new Set(["status", "history"]);

program.hook("preAction", (_thisCommand, actionCommand) => {
  if (EXEMPT_COMMANDS.has(actionCommand.name())) return;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\n  \u2717 ANTHROPIC_API_KEY is required.\n");
    console.error("  Set it in your environment before running the tuner:\n");
    console.error("    export ANTHROPIC_API_KEY=sk-ant-...\n");
    console.error("  The tuner uses Claude to analyze experiment results and");
    console.error("  generate config recommendations. Without an API key,");
    console.error("  the analysis phase cannot produce meaningful proposals.\n");
    process.exit(1);
  }
});

program.parse();

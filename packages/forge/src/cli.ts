#!/usr/bin/env node

/**
 * Forge CLI — Autonomous Engine Research Laboratory
 *
 * Commands:
 *   research   Start a new autonomous research session
 *   resume     Resume a paused session
 *   status     Show current session state
 *   history    List past sessions and results
 *   oracle     Direct oracle query (outside a session)
 *   baseline   Compute fresh baseline metrics
 */

import "dotenv/config";
import { Command } from "commander";
import { loadState, saveState, getActiveSession } from "./state/forge-state";
import { listSandboxes } from "./repl/sandbox";

const program = new Command();

program
  .name("forge")
  .description("Autonomous Engine Research Laboratory")
  .version("0.1.0");

/* ── research ─────────────────────────────────────────────── */

program
  .command("research")
  .description("Start a new autonomous research session")
  .option("--name <name>", "Session name", `session-${Date.now()}`)
  .option("--players <list>", "Comma-separated Lichess usernames")
  .option(
    "--focus <area>",
    "Focus area: accuracy, cpl, blunders, opening, endgame",
    "accuracy"
  )
  .option("--max-experiments <n>", "Max experiments before stopping", "20")
  .option("--seed <n>", "Random seed", "42")
  .option("--quick", "Use triage-size evaluations (50 positions)")
  .action(async (opts) => {
    const players = opts.players
      ? opts.players.split(",").map((s: string) => s.trim())
      : undefined;

    if (!players || players.length === 0) {
      console.error("  ✗ Specify at least one player with --players");
      process.exit(1);
    }

    // Pre-download all player data before starting the agent
    const { fetchPlayer, getGames } = await import("./data/game-store");
    console.log(`\n  Downloading data for ${players.length} player(s)...\n`);
    const validPlayers: string[] = [];
    for (const username of players) {
      try {
        console.log(`  [${username}] Fetching...`);
        const data = await fetchPlayer(username);
        const games = getGames(username);
        if (games.length === 0) {
          console.log(`  [${username}] ✗ 0 games found, skipping.`);
        } else {
          console.log(`  [${username}] ✓ ${games.length} games (Elo: ${data.estimatedElo})`);
          validPlayers.push(username);
        }
      } catch (err) {
        console.error(`  [${username}] ✗ Failed: ${err}`);
      }
    }

    if (validPlayers.length === 0) {
      console.error("\n  ✗ No valid players with games. Aborting.");
      process.exit(1);
    }

    console.log(`\n  Starting research with ${validPlayers.length} player(s): ${validPlayers.join(", ")}\n`);

    const { runResearchSession } = await import("./agent/agent-loop");
    await runResearchSession({
      name: opts.name,
      players: validPlayers,
      focus: opts.focus,
      maxExperiments: parseInt(opts.maxExperiments, 10),
      seed: parseInt(opts.seed, 10),
      quick: opts.quick ?? false,
    });
  });

/* ── resume ───────────────────────────────────────────────── */

program
  .command("resume [session-id]")
  .description("Resume a paused research session")
  .action(async (sessionId?: string) => {
    const state = loadState();

    const id = sessionId ?? state.activeSessionId;
    if (!id) {
      console.error("  ✗ No active session to resume. Specify a session ID.");
      process.exit(1);
    }

    const matches = state.sessions.filter((s) => s.id.startsWith(id));
    if (matches.length === 0) {
      console.error(`  ✗ No session matching "${id}".`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`  ✗ Ambiguous ID "${id}" matches ${matches.length} sessions. Be more specific.`);
      process.exit(1);
    }
    const session = matches[0];

    if (session.status !== "paused" && session.status !== "active") {
      console.error(
        `  ✗ Session ${id} is ${session.status}, cannot resume.`
      );
      process.exit(1);
    }

    const { resumeSession } = await import("./agent/agent-loop");
    await resumeSession(state, session);
  });

/* ── status ───────────────────────────────────────────────── */

program
  .command("status")
  .description("Show current forge state")
  .action(() => {
    const state = loadState();
    const active = getActiveSession(state);
    const sandboxes = listSandboxes();

    console.log("\n  Forge Status");
    console.log("  ════════════════════════════════════════");
    console.log(`  Sessions:     ${state.sessions.length}`);
    console.log(
      `  Active:       ${active ? `${active.name} (${active.id.slice(0, 8)})` : "none"}`
    );
    console.log(`  Sandboxes:    ${sandboxes.length}`);

    if (active) {
      console.log(`\n  Active Session: ${active.name}`);
      console.log(`  Status:       ${active.status}`);
      console.log(`  Experiments:  ${active.experiments.length}`);
      console.log(`  Players:      ${active.players.join(", ")}`);
      console.log(`  Cost:         $${active.totalCostUsd.toFixed(4)}`);
      console.log(`  Changes:      ${active.activeChanges.length} code changes`);

      if (active.bestResult) {
        console.log(`\n  Best Result:`);
        console.log(
          `    Accuracy:   ${(active.bestResult.moveAccuracy * 100).toFixed(1)}%`
        );
        console.log(
          `    CPL KL:     ${active.bestResult.cplKLDivergence.toFixed(4)}`
        );
        console.log(
          `    Composite:  ${active.bestResult.compositeScore.toFixed(4)}`
        );
      }
    }

    console.log();
  });

/* ── history ──────────────────────────────────────────────── */

program
  .command("history")
  .description("List past research sessions")
  .action(() => {
    const state = loadState();

    if (state.sessions.length === 0) {
      console.log("\n  No research sessions yet.\n");
      return;
    }

    console.log("\n  Research Sessions");
    console.log("  ════════════════════════════════════════");

    for (const session of state.sessions) {
      const status =
        session.status === "completed"
          ? "✓"
          : session.status === "active"
            ? "▶"
            : session.status === "paused"
              ? "⏸"
              : "✗";
      const best = session.bestResult
        ? `${(session.bestResult.moveAccuracy * 100).toFixed(1)}%`
        : "—";

      console.log(
        `  ${status} ${session.name.padEnd(30)} ` +
          `${session.experiments.length} exps  ` +
          `best: ${best}  ` +
          `$${session.totalCostUsd.toFixed(2)}  ` +
          `${session.id.slice(0, 8)}`
      );
    }
    console.log();
  });

/* ── oracle ───────────────────────────────────────────────── */

program
  .command("oracle <question>")
  .description("Direct oracle query (outside a session)")
  .option("--domain <domain>", "Knowledge domain", "general")
  .action(async (question: string, opts) => {
    const { consultOracle } = await import("./oracle/oracle");
    const result = await consultOracle({
      question,
      domain: opts.domain,
      context: "",
    });
    console.log("\n  Oracle Response");
    console.log("  ════════════════════════════════════════");
    console.log(`\n  Confidence: ${result.confidence}`);
    console.log(`\n  Synthesis:\n  ${result.claudeFinal}`);
    console.log(`\n  Action Items:`);
    for (const item of result.actionItems) {
      console.log(`    • ${item}`);
    }
    console.log();
  });

/* ── baseline ─────────────────────────────────────────────── */

program
  .command("baseline")
  .description("Compute fresh baseline metrics for players")
  .option("--players <list>", "Comma-separated Lichess usernames")
  .option("--seed <n>", "Random seed", "42")
  .option("--positions <n>", "Max positions per player", "200")
  .action(async (opts) => {
    console.log("\n  Computing baseline metrics...\n");

    // Lazy-import to avoid loading heavy modules on help/status
    const { computeBaseline } = await import("./metrics/maia-scorer");

    const players = opts.players
      ? opts.players.split(",").map((s: string) => s.trim())
      : undefined;

    if (!players || players.length === 0) {
      console.error("  ✗ Specify at least one player with --players");
      process.exit(1);
    }

    const baseline = await computeBaseline(players, {
      seed: parseInt(opts.seed, 10),
      maxPositions: parseInt(opts.positions, 10),
    });

    console.log(`  Move Accuracy:  ${(baseline.aggregate.moveAccuracy * 100).toFixed(1)}%`);
    console.log(`  CPL KL Div:     ${baseline.aggregate.cplKLDivergence.toFixed(4)}`);
    console.log(`  Composite:      ${baseline.aggregate.compositeScore.toFixed(4)}`);
    console.log();
  });

/* ── repl ────────────────────────────────────────────────── */

program
  .command("repl [players...]")
  .description("Interactive REPL with the forge API")
  .option("--players <list>", "Comma-separated Lichess usernames to pre-load")
  .option("--seed <n>", "Random seed", "42")
  .option("--session <id>", "Attach to an existing session (by ID prefix)")
  .action(async (positionalPlayers: string[], opts) => {
    const { createReplServer } = await import("./repl/repl-server");
    const { createSandbox, listSandboxes } = await import("./repl/sandbox");
    const { createForgeApi } = await import("./repl/forge-api");
    const { randomUUID } = await import("node:crypto");
    const readline = await import("node:readline");

    const state = loadState();
    let session: any;
    let sandbox: any;

    if (opts.session) {
      // Attach to existing session
      const matches = state.sessions.filter((s: any) => s.id.startsWith(opts.session));
      if (matches.length === 0) {
        console.error(`  ✗ No session matching "${opts.session}"`);
        process.exit(1);
      }
      session = matches[0];
      const sandboxes = listSandboxes();
      sandbox = sandboxes.find((s: any) => s.sessionId === session.id);
      if (!sandbox) {
        console.error(`  ✗ No sandbox for session ${session.id.slice(0, 8)}`);
        process.exit(1);
      }
      console.log(`\n  Attached to session: ${session.name} (${session.id.slice(0, 8)})`);
    } else {
      // Create a temporary session
      const sessionId = randomUUID();
      sandbox = createSandbox(sessionId);
      session = {
        id: sessionId,
        name: "repl-interactive",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "active",
        worktreeBranch: sandbox.branchName,
        focus: "accuracy",
        players: [],
        baseline: null,
        experiments: [],
        bestResult: null,
        bestExperimentId: null,
        activeChanges: [],
        conversationHistory: [],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        oracleConsultations: [],
      };
      console.log(`\n  Forge REPL (temp session ${sessionId.slice(0, 8)})`);
    }

    const repl = createReplServer();
    const forgeApi = createForgeApi(sandbox, session, state);
    repl.inject("forge", forgeApi);

    // Pre-load player data if requested (accept --players flag OR positional args)
    const playerList = opts.players
      ? opts.players.split(",").map((s: string) => s.trim())
      : positionalPlayers.flatMap((s: string) => s.split(",").map((p) => p.trim()));

    if (playerList.length > 0) {
      const players = playerList;
      const { fetchPlayer, getGames, loadPlayer } = await import("./data/game-store");
      const { createSplit } = await import("./data/splits");
      const seed = parseInt(opts.seed, 10);

      const playerData: Record<string, any> = {};
      for (const username of players) {
        try {
          console.log(`  Loading ${username}...`);
          await fetchPlayer(username);
          const meta = loadPlayer(username);
          const games = getGames(username);
          if (games.length > 0) {
            const result = createSplit(games, { seed, trainRatio: 0.8 });
            playerData[username] = { meta, games, ...result };
            console.log(`  ✓ ${username}: ${games.length} games`);
          }
        } catch (err) {
          console.error(`  ✗ ${username}: ${err}`);
        }
      }
      repl.inject("playerData", playerData);
    }

    console.log("  Type TypeScript code. Use `forge.*` and `playerData`. Ctrl+D to exit.\n");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "forge> ",
      completer: (line: string) => repl.complete(line),
    });

    rl.prompt();

    let buffer = "";

    rl.on("line", async (line: string) => {
      // Support multi-line input with trailing backslash
      if (line.endsWith("\\")) {
        buffer += line.slice(0, -1) + "\n";
        process.stdout.write("  ... ");
        return;
      }

      const code = buffer + line;
      buffer = "";

      if (!code.trim()) {
        rl.prompt();
        return;
      }

      const result = await repl.execute(code);

      if (result.output) {
        console.log(result.output);
      }
      if (result.error) {
        console.error(`  ✗ ${result.error}`);
      } else if (result.result !== undefined) {
        try {
          const display = typeof result.result === "string"
            ? result.result
            : JSON.stringify(result.result, null, 2);
          if (display && display !== "undefined") {
            console.log(display);
          }
        } catch {
          console.log(String(result.result));
        }
      }
      console.log(`  (${result.durationMs}ms)`);
      rl.prompt();
    });

    rl.on("close", () => {
      console.log("\n  Bye.\n");
      repl.dispose();
      process.exit(0);
    });
  });

/* ── clean ───────────────────────────────────────────────── */

program
  .command("clean")
  .description("Remove sessions and their sandboxes")
  .option("--all", "Remove all sessions without prompting")
  .option("--id <session-id>", "Remove a specific session by ID prefix")
  .action(async (opts) => {
    const state = loadState();

    if (state.sessions.length === 0) {
      console.log("\n  No sessions to clean.\n");
      return;
    }

    const { destroySandbox, listSandboxes } = await import("./repl/sandbox");
    const sandboxes = listSandboxes();

    let toRemove: typeof state.sessions;

    if (opts.id) {
      // Remove a specific session by ID prefix
      toRemove = state.sessions.filter((s) => s.id.startsWith(opts.id));
      if (toRemove.length === 0) {
        console.error(`  ✗ No session matching "${opts.id}"`);
        process.exit(1);
      }
    } else if (opts.all) {
      toRemove = [...state.sessions];
    } else {
      // Show sessions and let user confirm
      console.log("\n  Sessions:");
      for (const s of state.sessions) {
        const exps = s.experiments.length;
        const best = s.bestResult
          ? `best: ${(s.bestResult.moveAccuracy * 100).toFixed(1)}%`
          : "no results";
        console.log(
          `  ${s.id.slice(0, 8)}  ${s.name.padEnd(25)} ${s.status.padEnd(10)} ${exps} exps  ${best}`
        );
      }

      // Use readline for confirmation
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question("\n  Remove all sessions? (y/N): ", resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== "y") {
        console.log("  Cancelled.\n");
        return;
      }
      toRemove = [...state.sessions];
    }

    // Remove sandboxes (worktrees + branches)
    let cleaned = 0;
    for (const session of toRemove) {
      const sandbox = sandboxes.find((s) => s.sessionId === session.id);
      if (sandbox) {
        try {
          destroySandbox(sandbox);
          console.log(`  ✓ Removed sandbox for ${session.name} (${session.id.slice(0, 8)})`);
        } catch (err) {
          console.error(`  ✗ Failed to remove sandbox for ${session.id.slice(0, 8)}: ${err}`);
        }
      }
      cleaned++;
    }

    // Remove from state
    const removeIds = new Set(toRemove.map((s) => s.id));
    state.sessions = state.sessions.filter((s) => !removeIds.has(s.id));
    if (removeIds.has(state.activeSessionId ?? "")) {
      state.activeSessionId = null;
    }
    saveState(state);

    console.log(`\n  Cleaned ${cleaned} session(s).\n`);
  });

program.parse();

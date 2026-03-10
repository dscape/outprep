#!/usr/bin/env node

/**
 * Forge CLI — Autonomous Engine Research Laboratory
 *
 * Commands:
 *   agent      Manage autonomous agents (start, stop, ls)
 *   leaderboard Show the agent leaderboard
 *   ls         List all sessions with live running status
 *   status     Show current session state
 *   history    List past sessions and results
 *   attach     Attach REPL to the active session
 *   repl       Interactive REPL with the forge API
 *   oracle     Direct oracle query (outside a session)
 *   baseline   Compute fresh baseline metrics
 *   clean      Remove sessions and their sandboxes
 */

import "dotenv/config";
import { Command } from "commander";
import { loadState, saveState, getActiveSession, updateSession, updateAgent } from "./state/forge-state";
import { listSandboxes } from "./repl/sandbox";

const program = new Command();

program
  .name("forge")
  .description("Autonomous Engine Research Laboratory")
  .version("0.1.0");

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

      // Hypothesis info
      const hypothesisSets = active.hypothesisSets ?? [];
      if (hypothesisSets.length > 0) {
        const current = hypothesisSets[hypothesisSets.length - 1];
        const committed = current.hypotheses.find(
          (h) => h.level === current.committedLevel
        );
        console.log(`\n  Current Hypothesis:`);
        console.log(`    Level:      ${current.committedLevel}`);
        console.log(`    Archetype:  ${current.committedLevel === "groundbreaking" ? "EXPLORATORY" : "INCREMENTAL"}`);
        console.log(`    Statement:  ${committed?.statement?.slice(0, 80) ?? "(unknown)"}`);
      }

      // Surprise rate
      const surprises = active.oracleSurprises ?? [];
      if (surprises.length > 0) {
        const surprising = surprises.filter((s) => s.wasSurprising).length;
        const rate = surprising / surprises.length;
        const health = rate >= 0.2 ? "healthy" : "LOW";
        console.log(`\n  Surprise Rate: ${(rate * 100).toFixed(0)}% (${surprising}/${surprises.length}) [${health}]`);
      }

      // Kill signals
      const kills = active.killSignals ?? [];
      if (kills.length > 0) {
        console.log(`  Abandoned:    ${kills.length} hypothesis/experiment(s)`);
      }

      // Reflections
      const reflections = active.reflections ?? [];
      if (reflections.length > 0) {
        console.log(`  Reflections:  ${reflections.length}`);
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

      // Experiment archetype distribution
      const incremental = session.experiments.filter(
        (e) => (e.archetype ?? "incremental") === "incremental"
      ).length;
      const exploratory = session.experiments.filter(
        (e) => e.archetype === "exploratory"
      ).length;
      const archDist =
        session.experiments.length > 0
          ? `${incremental}i/${exploratory}e`
          : "—";

      // Hypothesis count
      const hCount = session.hypothesisSets?.length ?? 0;

      console.log(
        `  ${status} ${session.name.padEnd(30)} ` +
          `${session.experiments.length} exps (${archDist})  ` +
          `hyp: ${hCount}  ` +
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
    const { record: result } = await consultOracle({
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

/* ── fetch ────────────────────────────────────────────────── */

program
  .command("fetch <username>")
  .description("Fetch a player's game archive from Lichess")
  .option("--force", "Re-download even if cached")
  .option("--max <n>", "Max games to fetch", "200")
  .action(async (username: string, opts) => {
    const { fetchPlayer, getGames } = await import("./data/game-store");
    console.log(`  Fetching ${username}...`);
    try {
      const data = await fetchPlayer(username, {
        max: parseInt(opts.max, 10),
        force: opts.force ?? false,
      });
      const games = getGames(username);
      console.log(`  ✓ ${data.username}: ${games.length} games (Elo: ${data.estimatedElo})`);
      // Output JSON for programmatic consumption
      console.log(JSON.stringify(data));
    } catch (err) {
      console.error(`  ✗ Failed to fetch ${username}: ${err}`);
      process.exit(1);
    }
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

/* ── push ────────────────────────────────────────────────── */

program
  .command("push [session-id]")
  .description("Push research branch to GitHub for PR review")
  .action(async (sessionId?: string) => {
    const { execSync } = await import("node:child_process");
    const { commitSandbox } = await import("./repl/sandbox");
    const state = loadState();

    const id = sessionId ?? state.activeSessionId;
    if (!id) {
      console.error("  ✗ No active session. Specify a session ID.");
      process.exit(1);
    }

    const matches = state.sessions.filter((s) => s.id.startsWith(id));
    if (matches.length === 0) {
      console.error(`  ✗ No session matching "${id}".`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`  ✗ Ambiguous ID "${id}" matches ${matches.length} sessions.`);
      process.exit(1);
    }

    const session = matches[0];
    const sandboxes = listSandboxes();
    const sandbox = sandboxes.find((s) => s.sessionId === session.id);

    if (!sandbox) {
      console.error(`  ✗ No sandbox for session ${session.id.slice(0, 8)}`);
      process.exit(1);
    }

    // Commit any uncommitted changes
    commitSandbox(sandbox, `forge: pre-push checkpoint for ${session.name}`);

    // Push
    const branchName = sandbox.branchName;
    console.log(`\n  Pushing ${branchName}...`);
    execSync(`git push -u origin "${branchName}"`, {
      cwd: sandbox.worktreePath,
      stdio: "inherit",
    });

    // Print PR link
    try {
      const remoteUrl = execSync("git remote get-url origin", {
        cwd: sandbox.worktreePath,
        encoding: "utf-8",
      }).trim();
      const ghMatch = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
      if (ghMatch) {
        console.log(`\n  ✓ Pushed ${branchName}`);
        console.log(`  Create PR: https://github.com/${ghMatch[1]}/compare/${branchName}?expand=1\n`);
      }
    } catch {
      console.log(`\n  ✓ Pushed ${branchName}\n`);
    }
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

    // Pre-load player data if requested (accept --players flag OR positional args)
    const playerList = opts.players
      ? opts.players.split(",").map((s: string) => s.trim())
      : positionalPlayers.flatMap((s: string) => s.split(",").map((p) => p.trim()));

    const playerData: Record<string, any> = {};
    if (playerList.length > 0) {
      const { fetchPlayer, getGames, loadPlayer } = await import("./data/game-store");
      const { createSplit } = await import("./data/splits");
      const seed = parseInt(opts.seed, 10);

      for (const username of playerList) {
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
    }

    const repl = createReplServer();
    const forgeApi = createForgeApi(sandbox, session, state, playerData);
    repl.inject("forge", forgeApi);
    repl.inject("playerData", playerData);

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
    const { destroySandbox, listSandboxes } = await import("./repl/sandbox");
    const sandboxes = listSandboxes();

    // Detect orphaned sandboxes (worktrees with no matching session in state)
    const sessionIds = new Set(state.sessions.map((s) => s.id));
    const orphans = sandboxes.filter((s) => !sessionIds.has(s.sessionId));

    if (state.sessions.length === 0 && orphans.length === 0) {
      console.log("\n  No sessions to clean.\n");
      return;
    }

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
      if (state.sessions.length > 0) {
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
      }

      if (orphans.length > 0) {
        console.log(`\n  Orphaned sandboxes (no matching session in state): ${orphans.length}`);
        for (const o of orphans) {
          console.log(`  ${o.sessionId.slice(0, 8)}  branch: ${o.branchName}`);
        }
      }

      // Use readline for confirmation
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const total = state.sessions.length + orphans.length;
      const answer = await new Promise<string>((resolve) => {
        rl.question(`\n  Remove ${total} session(s)/sandbox(es)? (y/N): `, resolve);
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

    // Remove orphaned sandboxes
    if (!opts.id) {
      for (const orphan of orphans) {
        try {
          destroySandbox(orphan);
          console.log(`  ✓ Removed orphaned sandbox ${orphan.sessionId.slice(0, 8)} (${orphan.branchName})`);
        } catch (err) {
          console.error(`  ✗ Failed to remove orphaned sandbox ${orphan.sessionId.slice(0, 8)}: ${err}`);
        }
        cleaned++;
      }
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

/* ── ls ─────────────────────────────────────────────────── */

program
  .command("ls")
  .description("List all sessions with live running status")
  .action(async () => {
    const { readPid, isProcessRunning } = await import("./pid");
    const state = loadState();

    if (state.sessions.length === 0) {
      console.log("\n  No research sessions.\n");
      return;
    }

    console.log("\n  Sessions");
    console.log("  ════════════════════════════════════════");

    for (const session of state.sessions) {
      const icon =
        session.status === "completed"
          ? "✓"
          : session.status === "active"
            ? "▶"
            : session.status === "paused"
              ? "⏸"
              : "✗";

      const isActive = session.id === state.activeSessionId;
      const pid = readPid(session.id);
      const running = pid !== null && isProcessRunning(pid);

      const best = session.bestResult
        ? `${(session.bestResult.moveAccuracy * 100).toFixed(1)}%`
        : "—";

      const tags = [
        isActive ? "★" : "",
        running ? "RUNNING" : "",
      ].filter(Boolean).join(" ");

      console.log(
        `  ${icon} ${session.name.padEnd(25)} ` +
          `${String(session.experiments.length).padStart(3)} exps  ` +
          `best: ${best.padEnd(6)}  ` +
          `$${session.totalCostUsd.toFixed(2).padStart(6)}  ` +
          `${session.id.slice(0, 8)}` +
          (tags ? `  ${tags}` : "")
      );
    }
    console.log();
  });

/* ── agent ───────────────────────────────────────────────── */

const agent = program
  .command("agent")
  .description("Manage autonomous agents");

agent
  .command("start")
  .description("Start a new autonomous agent (autonomous mode if no --players/--focus)")
  .option("--players <list>", "Comma-separated Lichess usernames (optional — autonomous if omitted)")
  .option(
    "--focus <area>",
    "Focus area(s), comma-separated (optional — autonomous if omitted)"
  )
  .option("--max-experiments <n>", "Max experiments per session", "20")
  .option("--seed <n>", "Random seed", "42")
  .option("--quick", "Use triage-size evaluations")
  .option("--bias <n>", "Research bias 0.0=conservative 1.0=aggressive", "0.5")
  .option("--all", "Re-start all stopped agents with their saved config")
  .option("--resume <agentId>", "Re-start a specific stopped agent by ID")
  .action(async (opts) => {
    if (opts.resume) {
      const { resumeAgent } = await import("./agent/agent-manager");
      console.log(`\n  Resuming agent ${opts.resume.slice(0, 8)}...\n`);
      await resumeAgent(opts.resume);
      return;
    }

    if (opts.all) {
      // Re-start all stopped agents
      const { readAgentPid, isProcessRunning } = await import("./pid");
      const { resumeAgent } = await import("./agent/agent-manager");
      const state = loadState();
      const stopped = state.agents.filter((a) => {
        if (a.status !== "stopped") return false;
        const pid = readAgentPid(a.id);
        return pid === null || !isProcessRunning(pid);
      });

      if (stopped.length === 0) {
        console.log("\n  No stopped agents to start.\n");
        return;
      }

      console.log(`\n  Starting ${stopped.length} stopped agent(s)...\n`);
      for (const a of stopped) {
        console.log(`  Starting "${a.name}" (${a.id.slice(0, 8)})...`);
        await resumeAgent(a.id);
      }
      return;
    }

    const players = opts.players
      ? opts.players.split(",").map((s: string) => s.trim())
      : undefined;

    const focus = opts.focus ?? undefined;

    if (!players && !focus) {
      console.log("\n  Autonomous mode — agent will decide players and focus.\n");
    }

    const researchBias = Math.max(0, Math.min(1, parseFloat(opts.bias)));

    const { startAgent } = await import("./agent/agent-manager");
    await startAgent({
      players,
      focus,
      maxExperiments: parseInt(opts.maxExperiments, 10),
      seed: parseInt(opts.seed, 10),
      quick: opts.quick ?? false,
      researchBias,
    });
  });

agent
  .command("stop [agent-id]")
  .description("Stop a running agent")
  .option("--all", "Stop all running agents")
  .action(async (agentId: string | undefined, opts: { all?: boolean }) => {
    const { readAgentPid, isProcessRunning } = await import("./pid");
    const state = loadState();

    let targets: typeof state.agents;

    if (opts.all) {
      targets = state.agents.filter((a) => {
        const pid = readAgentPid(a.id);
        return pid !== null && isProcessRunning(pid);
      });
    } else {
      if (!agentId) {
        console.error("  ✗ Specify an agent ID or use --all.");
        process.exit(1);
      }
      targets = state.agents.filter((a) => a.id.startsWith(agentId) || a.name.toLowerCase() === agentId.toLowerCase());
      if (targets.length === 0) {
        console.error(`  ✗ No agent matching "${agentId}".`);
        process.exit(1);
      }
      if (targets.length > 1) {
        console.error(`  ✗ Ambiguous ID "${agentId}" matches ${targets.length} agents.`);
        process.exit(1);
      }
    }

    if (targets.length === 0) {
      console.log("\n  No running agents to stop.\n");
      return;
    }

    for (const a of targets) {
      const pid = readAgentPid(a.id);
      if (pid === null || !isProcessRunning(pid)) {
        console.log(`  ${a.name} (${a.id.slice(0, 8)}) — not running`);
        // Still mark as stopped in state
        if (a.currentSessionId) {
          try { updateSession(state, a.currentSessionId, (s) => { s.status = "paused"; }); } catch { /* session may not exist */ }
        }
        updateAgent(state, a.id, (ag) => { ag.status = "stopped"; });
        continue;
      }

      try {
        process.kill(pid, "SIGINT");
        console.log(`  ✓ Sent SIGINT to "${a.name}" (pid ${pid})`);
        updateAgent(state, a.id, (ag) => { ag.status = "stopped"; });
      } catch (err) {
        console.error(`  ✗ Failed to stop "${a.name}": ${err}`);
      }
    }
    console.log();
  });

agent
  .command("assign <agent-id> <session-id>")
  .description("Assign an agent to a specific session")
  .action(async (agentIdArg: string, sessionIdArg: string) => {
    const { readAgentPid, isProcessRunning } = await import("./pid");
    const state = loadState();

    // Find agent by ID prefix or name
    const agents = state.agents.filter(
      (a) => a.id.startsWith(agentIdArg) || a.name.toLowerCase() === agentIdArg.toLowerCase()
    );
    if (agents.length === 0) {
      console.error(`  ✗ No agent matching "${agentIdArg}".`);
      process.exit(1);
    }
    if (agents.length > 1) {
      console.error(`  ✗ Ambiguous agent "${agentIdArg}" matches ${agents.length} agents.`);
      process.exit(1);
    }
    const agent = agents[0];

    // Find session by ID prefix
    const sessions = state.sessions.filter((s) => s.id.startsWith(sessionIdArg));
    if (sessions.length === 0) {
      console.error(`  ✗ No session matching "${sessionIdArg}".`);
      process.exit(1);
    }
    if (sessions.length > 1) {
      console.error(`  ✗ Ambiguous session "${sessionIdArg}" matches ${sessions.length} sessions.`);
      process.exit(1);
    }
    const session = sessions[0];

    // Check session isn't locked by a running agent
    if (session.agentId && session.agentId !== agent.id) {
      const ownerAgent = state.agents.find((a) => a.id === session.agentId);
      if (ownerAgent) {
        const pid = readAgentPid(ownerAgent.id);
        if (pid && isProcessRunning(pid)) {
          console.error(`  ✗ Session is currently active on running agent "${ownerAgent.name}".`);
          process.exit(1);
        }
      }
    }

    // Assign
    updateSession(state, session.id, (s) => {
      s.agentId = agent.id;
    });
    updateAgent(state, agent.id, (a) => {
      a.currentSessionId = session.id;
    });

    console.log(`\n  ✓ Assigned agent "${agent.name}" (${agent.id.slice(0, 8)}) to session "${session.name}" (${session.id.slice(0, 8)})\n`);
  });

agent
  .command("ls")
  .description("List all agents with status and ranking")
  .action(async () => {
    const { readAgentPid, isProcessRunning } = await import("./pid");
    const { getLeaderboard } = await import("./state/leaderboard-db");
    const state = loadState();

    if (state.agents.length === 0) {
      console.log("\n  No agents.\n");
      return;
    }

    const leaderboard = getLeaderboard();
    const rankMap = new Map(leaderboard.map((e) => [e.agentId, e]));

    console.log("\n  Agents");
    console.log("  ════════════════════════════════════════");

    for (const a of state.agents) {
      const pid = readAgentPid(a.id);
      const running = pid !== null && isProcessRunning(pid);
      const icon = running ? "▶" : a.status === "stopped" ? "⏸" : "·";

      const entry = rankMap.get(a.id);
      const rank = entry ? `#${entry.rank}` : "—";
      const avgDelta = entry
        ? `${entry.avgWeightedCompositeDelta > 0 ? "+" : ""}${entry.avgWeightedCompositeDelta.toFixed(4)}`
        : "—";
      const sessions = a.sessionHistory.length;
      const currentSession = a.currentSessionId
        ? state.sessions.find((s) => s.id === a.currentSessionId)?.name ?? a.currentSessionId.slice(0, 8)
        : "—";

      const bias = a.config.researchBias ?? 0.5;
      const biasLabel = bias >= 0.75 ? "aggressive" : bias >= 0.4 ? "balanced" : "conservative";

      console.log(
        `  ${icon} ${a.name.padEnd(15)} ` +
          `rank: ${rank.padEnd(4)} ` +
          `avg Δ: ${avgDelta.padEnd(8)} ` +
          `bias: ${biasLabel.padEnd(13)} ` +
          `sessions: ${String(sessions).padStart(3)}  ` +
          `current: ${currentSession.slice(0, 20)}  ` +
          `$${a.totalCostUsd.toFixed(2).padStart(6)}  ` +
          (running ? "RUNNING" : a.status)
      );
    }
    console.log();
  });

/* ── leaderboard ─────────────────────────────────────────── */

program
  .command("leaderboard")
  .description("Show the agent leaderboard")
  .action(async () => {
    const { getLeaderboard } = await import("./state/leaderboard-db");
    const leaderboard = getLeaderboard();

    if (leaderboard.length === 0) {
      console.log("\n  No leaderboard entries yet.\n");
      return;
    }

    console.log("\n  Agent Leaderboard");
    console.log("  ════════════════════════════════════════════════════════════════");
    console.log(
      `  ${"Rank".padEnd(6)}${"Agent".padEnd(16)}${"Weighted Avg Δ".padEnd(16)}` +
        `${"Accuracy Δ".padEnd(14)}${"CPL KL Δ".padEnd(12)}` +
        `${"Sessions".padEnd(10)}${"Time".padEnd(8)}${"Cost".padEnd(8)}`
    );
    console.log("  " + "─".repeat(86));

    for (const e of leaderboard) {
      const sign = e.avgWeightedCompositeDelta > 0 ? "+" : "";
      const accSign = e.avgAccuracyDelta > 0 ? "+" : "";
      const cplSign = e.avgCplKlDelta > 0 ? "+" : "";
      const hours = Math.round(e.totalTimeSeconds / 3600);
      console.log(
        `  ${`#${e.rank}`.padEnd(6)}${e.agentName.padEnd(16)}` +
          `${(sign + e.avgWeightedCompositeDelta.toFixed(4)).padEnd(16)}` +
          `${(accSign + (e.avgAccuracyDelta * 100).toFixed(1) + "%").padEnd(14)}` +
          `${(cplSign + e.avgCplKlDelta.toFixed(4)).padEnd(12)}` +
          `${String(e.sessionsCount).padEnd(10)}` +
          `${hours + "h".padEnd(8)}` +
          `$${e.totalCostUsd.toFixed(2)}`
      );
    }
    console.log();
  });

/* ── attach ─────────────────────────────────────────────── */

program
  .command("attach")
  .description("Attach REPL to the active session")
  .action(async () => {
    const state = loadState();
    const active = getActiveSession(state);

    if (!active) {
      console.error("  ✗ No active session to attach to.");
      process.exit(1);
    }

    await program.parseAsync(["node", "forge", "repl", "--session", active.id], {
      from: "user",
    });
  });

program.parse();

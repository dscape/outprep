/**
 * Agent lifecycle manager — the outer loop wrapping runAgentLoop.
 *
 * Manages agent creation, session cycling, leaderboard recording,
 * and feature request handling. This is the ONLY module that writes
 * to the leaderboard SQLite database (anti-cheating).
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { loadState, saveState, updateSession, updateAgent } from "../state/forge-state";
import { createSandbox, destroySandbox } from "../repl/sandbox";
import { createReplServer } from "../repl/repl-server";
import { createForgeApi } from "../repl/forge-api";
import { writePid, removePid, writeAgentPid, removeAgentPid } from "../pid";
import { generateAgentName } from "./agent-names";
import {
  recordSessionResult,
  fileFeatureRequest,
  getLeaderboard,
  getAgentStats,
} from "../state/leaderboard-db";
import { CostTracker } from "./cost-tracker";
import { createLogWriter } from "./log-writer";
import { runAgentLoop, buildInitialMessage } from "./agent-loop";
import type { ForgeAgent, ForgeSession } from "../state/types";

export interface AgentOptions {
  players: string[];
  focus: string;
  maxExperiments: number;
  seed: number;
  quick: boolean;
}

/**
 * Start a new agent with the outer loop.
 * Creates an agent record and begins cycling sessions.
 */
export async function startAgent(opts: AgentOptions): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("  ✗ ANTHROPIC_API_KEY is required");
    process.exit(1);
  }

  const state = loadState();

  // Generate a unique agent name
  const existingNames = state.agents.map((a) => a.name);
  const agentName = generateAgentName(existingNames);
  const agentId = randomUUID();

  // Create agent record
  const agent: ForgeAgent = {
    id: agentId,
    name: agentName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "running",
    currentSessionId: null,
    sessionHistory: [],
    config: {
      players: opts.players,
      focus: opts.focus,
      maxExperiments: opts.maxExperiments,
      seed: opts.seed,
      quick: opts.quick,
    },
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
  };

  state.agents.push(agent);
  saveState(state);

  console.log(`\n  Agent "${agentName}" created (${agentId.slice(0, 8)})`);

  await runAgentOuterLoop(agentId, opts);
}

/**
 * Resume a stopped agent — marks it as running and enters the outer loop.
 */
export async function resumeAgent(agentId: string): Promise<void> {
  const state = loadState();
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) {
    console.error(`  ✗ Agent ${agentId} not found.`);
    process.exit(1);
  }
  if (agent.status === "running") {
    console.error(`  ✗ Agent "${agent.name}" is already running.`);
    process.exit(1);
  }

  updateAgent(state, agentId, (a) => {
    a.status = "running";
  });

  console.log(`\n  Resuming agent "${agent.name}" (${agentId.slice(0, 8)})`);

  await runAgentOuterLoop(agentId, agent.config);
}

/**
 * The outer loop: cycles sessions for an agent until stopped.
 */
async function runAgentOuterLoop(
  agentId: string,
  opts: AgentOptions
): Promise<void> {
  writeAgentPid(agentId);

  // Pre-download player data once (reused across sessions)
  const { fetchPlayer, getGames } = await import("../data/game-store");

  console.log(`  Downloading data for ${opts.players.length} player(s)...\n`);
  const validPlayers: string[] = [];
  for (const username of opts.players) {
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
    console.error("\n  ✗ No valid players with games. Stopping agent.");
    const state = loadState();
    updateAgent(state, agentId, (a) => {
      a.status = "stopped";
    });
    removeAgentPid(agentId);
    return;
  }

  let sessionNumber = 0;
  try {
    while (true) {
      // Re-load state to check if agent was stopped externally
      const freshState = loadState();
      const freshAgent = freshState.agents.find((a) => a.id === agentId);
      if (!freshAgent || freshAgent.status !== "running") {
        console.log(`\n  Agent "${freshAgent?.name ?? agentId}" stopped externally.`);
        break;
      }

      sessionNumber++;
      const sessionStartedAt = new Date().toISOString();

      console.log(`\n  ══════════════════════════════════════════`);
      console.log(`  Agent "${freshAgent.name}" — Session #${sessionNumber}`);
      console.log(`  ══════════════════════════════════════════\n`);

      // Run a single session
      const result = await runAgentSession(
        agentId,
        freshAgent.name,
        validPlayers,
        opts,
        sessionStartedAt,
      );

      if (!result.session) {
        console.log(`\n  Session failed to start. Agent stopping.`);
        break;
      }

      // Record results to SQLite leaderboard
      recordSessionToLeaderboard(
        agentId,
        freshAgent.name,
        result.session,
        sessionStartedAt,
      );

      // Update agent session history
      const currentState = loadState();
      updateAgent(currentState, agentId, (a) => {
        a.sessionHistory.push({
          sessionId: result.session!.id,
          sessionName: result.session!.name,
          startedAt: sessionStartedAt,
          endedAt: new Date().toISOString(),
          endReason: result.session!.status === "completed" ? "completed" : "abandoned",
        });
        a.currentSessionId = null;
        a.totalInputTokens += result.session!.totalInputTokens;
        a.totalOutputTokens += result.session!.totalOutputTokens;
        a.totalCostUsd += result.session!.totalCostUsd;
      });

      // Show leaderboard after session
      printLeaderboard(agentId);

      // If session completed or abandoned, continue with next session
      if (
        result.session.status === "completed" ||
        result.session.status === "abandoned"
      ) {
        console.log(`\n  Session ${result.session.status}. Starting next session...`);
        continue;
      }

      // If paused (error/stopped), break
      console.log(`\n  Session paused. Agent stopping.`);
      break;
    }
  } finally {
    const finalState = loadState();
    const finalAgent = finalState.agents.find((a) => a.id === agentId);
    if (finalAgent && finalAgent.status === "running") {
      updateAgent(finalState, agentId, (a) => {
        a.status = "stopped";
      });
    }
    removeAgentPid(agentId);
    console.log(`\n  Agent stopped.`);
  }
}

/**
 * Run a single research session for an agent.
 */
async function runAgentSession(
  agentId: string,
  agentName: string,
  players: string[],
  opts: AgentOptions,
  _startedAt: string,
): Promise<{ session: ForgeSession | null }> {
  const state = loadState();
  const costTracker = new CostTracker();
  const sessionId = randomUUID();
  const sessionName = `${agentName}-${Date.now()}`;
  const logWriter = createLogWriter(sessionName);

  const log = (msg: string, level: "info" | "warn" | "error" = "info") => {
    if (level === "error") console.error(msg);
    else if (level === "warn") console.warn(msg);
    else console.log(msg);
    logWriter.log(msg, level);
  };

  log(`  Session: ${sessionName}`);
  log(`  Session ID: ${sessionId.slice(0, 8)}`);
  log(`  Focus: ${opts.focus}`);
  log(``);

  // Create sandbox (git worktree)
  log("  Creating sandbox...");
  const sandbox = createSandbox(sessionId);
  log(`  Sandbox: ${sandbox.worktreePath}`);

  // Create session record
  const session: ForgeSession = {
    id: sessionId,
    name: sessionName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
    agentId,
    worktreeBranch: sandbox.branchName,
    focus: opts.focus,
    players,
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
    interactions: [],
    hypothesisSets: [],
    oracleSurprises: [],
    killSignals: [],
    reflections: [],
  };

  state.sessions.push(session);
  state.activeSessionId = sessionId;
  saveState(state);
  writePid(sessionId);

  // Update agent's current session
  updateAgent(state, agentId, (a) => {
    a.currentSessionId = sessionId;
  });

  // Build player data
  const { getGames, loadPlayer } = await import("../data/game-store");
  const { createSplit } = await import("../data/splits");

  const playerData: Record<string, {
    meta: ReturnType<typeof loadPlayer>;
    games: ReturnType<typeof getGames>;
    trainGames: ReturnType<typeof getGames>;
    testGames: ReturnType<typeof getGames>;
    split: ReturnType<typeof createSplit>["split"];
  }> = {};

  for (const username of players) {
    const meta = loadPlayer(username);
    const games = getGames(username);
    if (meta && games.length > 0) {
      const result = createSplit(games, { seed: opts.seed, trainRatio: 0.8 });
      playerData[username] = {
        meta,
        games,
        trainGames: result.trainGames,
        testGames: result.testGames,
        split: result.split,
      };
    }
  }

  // Create REPL and inject forge API
  const repl = createReplServer();
  repl.inject("playerData", playerData);

  const forgeApi = createForgeApi(sandbox, session, state, playerData);

  // Inject leaderboard (read-only) and feature request callback.
  // These bypass the ForgeApi type intentionally — agents cannot
  // write to the leaderboard, only the agent-manager writes.
  (forgeApi as any).leaderboard = {
    get: () => getLeaderboard(),
    me: () => getAgentStats(agentId),
  };
  (forgeApi as any).request = (
    title: string,
    description: string,
    category: string,
  ): string => {
    const reqId = randomUUID();
    fileFeatureRequest({
      id: reqId,
      agentId,
      agentName,
      sessionId: session.id,
      title,
      description,
      category,
    });
    console.log(`  Feature request filed: ${title}`);
    return reqId;
  };

  repl.inject("forge", forgeApi);

  const agent = state.agents.find((a) => a.id === agentId);
  const promptCtx = {
    session,
    state,
    baseline: session.baseline,
    focus: opts.focus,
    maxExperiments: opts.maxExperiments,
    agent,
  };

  const initialMessage = buildInitialMessage(
    {
      name: sessionName,
      players,
      focus: opts.focus,
      maxExperiments: opts.maxExperiments,
      seed: opts.seed,
      quick: opts.quick,
    },
    playerData,
  );

  try {
    await runAgentLoop(
      client(),
      repl,
      session,
      state,
      promptCtx,
      initialMessage,
      costTracker,
      {
        name: sessionName,
        players,
        focus: opts.focus,
        maxExperiments: opts.maxExperiments,
        seed: opts.seed,
        quick: opts.quick,
      },
      logWriter,
    );
  } catch (err) {
    log(`\n  ✗ Session error: ${err}`, "error");
    updateSession(state, sessionId, (s) => {
      s.status = "paused";
    });
  } finally {
    removePid(sessionId);
    repl.dispose();
    if (session.status === "completed" || session.status === "abandoned") {
      destroySandbox(sandbox);
    }
  }

  logWriter.close();
  return { session };
}

/* ── Helpers ─────────────────────────────────────────────── */

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _client;
}

function recordSessionToLeaderboard(
  agentId: string,
  agentName: string,
  session: ForgeSession,
  startedAt: string,
): void {
  const endedAt = new Date().toISOString();
  const durationMs =
    new Date(endedAt).getTime() - new Date(startedAt).getTime();

  // Compute deltas vs baseline
  const baselineComposite =
    session.baseline?.aggregate?.compositeScore ?? 0;
  const bestComposite = session.bestResult?.compositeScore ?? 0;
  const compositeDelta = bestComposite - baselineComposite;

  const baselineAccuracy =
    session.baseline?.aggregate?.moveAccuracy ?? 0;
  const bestAccuracy = session.bestResult?.moveAccuracy ?? 0;
  const accuracyDelta = bestAccuracy - baselineAccuracy;

  const baselineCplKl =
    session.baseline?.aggregate?.cplKLDivergence ?? 0;
  const bestCplKl =
    session.bestResult?.cplKLDivergence ?? baselineCplKl;
  // Negate so positive = improvement (lower KL is better)
  const cplKlDelta = -(bestCplKl - baselineCplKl);

  // Check if session was exploratory (groundbreaking hypothesis)
  const hypothesisSets = session.hypothesisSets ?? [];
  const latestHypothesis =
    hypothesisSets.length > 0
      ? hypothesisSets[hypothesisSets.length - 1]
      : null;
  const isExploratory =
    latestHypothesis?.committedLevel === "groundbreaking";

  recordSessionResult({
    id: randomUUID(),
    agentId,
    agentName,
    sessionId: session.id,
    sessionName: session.name,
    startedAt,
    endedAt,
    durationSeconds: Math.round(durationMs / 1000),
    experimentsCount: session.experiments.length,
    accuracyDelta,
    cplKlDelta,
    compositeDelta,
    isExploratory,
    totalCostUsd: session.totalCostUsd,
  });
}

function printLeaderboard(currentAgentId: string): void {
  const leaderboard = getLeaderboard();
  if (leaderboard.length === 0) return;

  console.log(`\n  Leaderboard:`);
  for (const entry of leaderboard) {
    const marker = entry.agentId === currentAgentId ? " ← YOU" : "";
    const sign = entry.avgWeightedCompositeDelta > 0 ? "+" : "";
    console.log(
      `  #${entry.rank} ${entry.agentName.padEnd(15)} ` +
        `avg Δ: ${sign}${entry.avgWeightedCompositeDelta.toFixed(4)}  ` +
        `sessions: ${entry.sessionsCount}${marker}`,
    );
  }
}

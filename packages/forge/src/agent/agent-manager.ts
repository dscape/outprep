/**
 * Agent lifecycle manager — the outer loop wrapping runAgentLoop.
 *
 * Manages agent creation, session cycling, leaderboard recording,
 * and feature request handling. This is the ONLY module that writes
 * to the leaderboard SQLite database (anti-cheating).
 *
 * Agents can run in two modes:
 * - **Fixed mode**: started with --players/--focus, locked to those settings.
 * - **Autonomous mode**: no players/focus provided, uses LLM decision step
 *   between sessions to decide what to work on next.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { loadState, saveState, updateSession, updateAgent } from "../state/forge-state";
import { createSandbox, destroySandbox, listSandboxes, commitSandbox, pushBranch } from "../repl/sandbox";
import { createReplServer } from "../repl/repl-server";
import { createForgeApi } from "../repl/forge-api";
import { writeAgentPid, removeAgentPid, cleanStalePids } from "../pid";
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
import { makeDecision, type DecisionResult } from "./agent-decision";
import { buildPlayerData, getPlayerEloMap } from "./shared";
import { defaultPermissions } from "../tools/permissions";
import { initSandboxRuntime, resetSandboxRuntime } from "../repl/sandbox-runtime";
import type { ForgeAgent, ForgeSession, AgentDecision } from "../state/types";
import { generatePaper } from "../papers/paper-generator";
import { generateReview } from "../papers/paper-reviewer";
import { adjudicateReviews } from "../papers/paper-adjudicator";
import { getPaper, updatePaper, insertReview, getReviewsForPaper, getReviewCountForPaper } from "../papers/paper-db";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Build a semantic session name from players, focus, and ELO range.
 * e.g. "accuracy-elo1500-1800-alice+bob", "opening+endgame-elo2200-DrNykterstein"
 */
function buildSessionName(
  players: string[],
  focus: string,
  state: { sessions: { name: string }[] },
  playerElos?: Map<string, number>,
): string {
  const focusPart = focus.replace(/,/g, "+");
  let base: string;

  if (players.length === 0) {
    base = `research-${focusPart}`;
  } else {
    const elos = players
      .map((p) => playerElos?.get(p))
      .filter((e): e is number => e != null)
      .sort((a, b) => a - b);
    const eloPart =
      elos.length > 0
        ? elos.length === 1
          ? `${elos[0]}`
          : `${elos[0]}-${elos[elos.length - 1]}`
        : "unk";
    const playerPart =
      players.length <= 2
        ? players.join("+")
        : `${players[0]}+${players.length - 1}more`;
    base = `${focusPart}-elo${eloPart}-${playerPart}`;
  }

  // Deduplicate: append -v2, -v3, etc. if name already exists
  const existingNames = new Set(state.sessions.map((s) => s.name));
  if (!existingNames.has(base)) return base;
  for (let v = 2; ; v++) {
    const candidate = `${base}-v${v}`;
    if (!existingNames.has(candidate)) return candidate;
  }
}

export interface AgentOptions {
  players?: string[];    // Optional — autonomous if absent
  focus?: string;        // Optional — autonomous if absent
  maxExperiments: number;
  seed: number;
  quick: boolean;
  researchBias?: number; // 0.0 = conservative, 1.0 = aggressive, default 0.5
}

/** Whether the agent is running in autonomous mode (no fixed players/focus) */
function isAutonomous(opts: AgentOptions): boolean {
  return !opts.players?.length && !opts.focus;
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
      researchBias: opts.researchBias,
    },
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
  };

  state.agents.push(agent);
  saveState(state);

  const mode = isAutonomous(opts) ? "autonomous" : "fixed";
  console.log(`\n  Agent "${agentName}" created (${agentId.slice(0, 8)}) — ${mode} mode`);

  await runAgentOuterLoop(agentId, agentName, opts);
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
  if (agent.status === "running" || agent.status === "waiting_for_tool" || agent.status === "blocked_on_permission") {
    // Check if the process is actually alive — stale state is common after crashes
    const { readAgentPid, isProcessRunning } = await import("../pid");
    const pid = readAgentPid(agentId);
    if (pid && isProcessRunning(pid)) {
      console.error(`  ✗ Agent "${agent.name}" is already running (pid ${pid}).`);
      process.exit(1);
    }
    // Stale state — process is dead, reset to stopped and continue
    console.log(`  Agent "${agent.name}" was marked ${agent.status} but process is dead. Resetting...`);
    updateAgent(state, agentId, (a) => {
      a.status = "stopped";
    });
  }

  updateAgent(state, agentId, (a) => {
    a.status = "running";
  });

  console.log(`\n  Resuming agent "${agent.name}" (${agentId.slice(0, 8)})`);

  await runAgentOuterLoop(agentId, agent.name, agent.config);
}

/**
 * The outer loop: cycles sessions for an agent until stopped.
 *
 * In autonomous mode, each iteration calls makeDecision() to decide
 * what players/focus to use or whether to resume an existing session.
 * In fixed mode, the decision is implicit (always start_new with fixed config).
 */
async function runAgentOuterLoop(
  agentId: string,
  agentName: string,
  opts: AgentOptions
): Promise<void> {
  writeAgentPid(agentId);

  // Clean stale PIDs on startup
  const stalePids = cleanStalePids();
  if (stalePids.length > 0) {
    console.log(`  Cleaned ${stalePids.length} stale PID file(s)`);
  }

  const autonomous = isAutonomous(opts);
  let waitRetries = 0;
  const MAX_WAIT_RETRIES = 10;
  let sessionNumber = 0;

  try {
    while (true) {
      // Re-load state to check if agent was stopped externally
      const freshState = loadState();
      const freshAgent = freshState.agents.find((a) => a.id === agentId);
      if (
        !freshAgent ||
        (freshAgent.status !== "running" &&
         freshAgent.status !== "waiting_for_tool" &&
         freshAgent.status !== "blocked_on_permission")
      ) {
        console.log(`\n  Agent "${freshAgent?.name ?? agentId}" stopped externally.`);
        break;
      }

      // ── Check for blocking tool jobs (with retry + circuit-breaker) ──
      {
        const { getForgeDb } = await import("../state/forge-db");
        const db = getForgeDb();
        const MAX_RETRIES = 3;
        const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

        const blockingJobs = db.prepare(
          `SELECT * FROM tool_jobs WHERE agent_id = ? AND blocking = 1 AND status NOT IN ('completed') LIMIT 5`
        ).all(agentId) as any[];

        let shouldStop = false;
        let stopReason = "";
        let hasBlockingWork = false;

        for (const job of blockingJobs) {
          const retryCount = job.retry_count ?? 0;
          const age = Date.now() - new Date(job.created_at).getTime();
          const target = (() => { try { const p = JSON.parse(job.input ?? "{}"); return p.username || p.query || p.url || ""; } catch { return ""; } })();

          if (job.status === "archived" || job.status === "failed") {
            // Job failed or was archived — retry or die
            if (retryCount >= MAX_RETRIES) {
              shouldStop = true;
              stopReason = `Tool '${job.tool_name}'${target ? ` for '${target}'` : ""} failed after ${MAX_RETRIES} attempts (last status: ${job.status})`;
              break;
            }
            // Re-submit with incremented retry count
            const newId = (await import("node:crypto")).randomUUID();
            const now = new Date().toISOString();
            db.prepare(
              `INSERT INTO tool_jobs (id, session_id, agent_id, tool_name, status, input, created_at, blocking, retry_count)
               VALUES (?, ?, ?, ?, 'pending', ?, ?, 1, ?)`
            ).run(newId, job.session_id, agentId, job.tool_name, job.input, now, retryCount + 1);
            console.log(`  Retrying ${job.tool_name}${target ? ` for '${target}'` : ""} (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`);
            hasBlockingWork = true;
          } else if (job.status === "pending" && age > STALE_THRESHOLD_MS) {
            // Stale pending job — archive and retry
            if (retryCount >= MAX_RETRIES) {
              shouldStop = true;
              stopReason = `Tool '${job.tool_name}'${target ? ` for '${target}'` : ""} timed out after ${MAX_RETRIES} attempts`;
              break;
            }
            // Archive the stale job
            db.prepare(
              `UPDATE tool_jobs SET status = 'archived', archived_at = ? WHERE id = ?`
            ).run(new Date().toISOString(), job.id);
            // Re-submit
            const newId = (await import("node:crypto")).randomUUID();
            const now = new Date().toISOString();
            db.prepare(
              `INSERT INTO tool_jobs (id, session_id, agent_id, tool_name, status, input, created_at, blocking, retry_count)
               VALUES (?, ?, ?, ?, 'pending', ?, ?, 1, ?)`
            ).run(newId, job.session_id, agentId, job.tool_name, job.input, now, retryCount + 1);
            console.log(`  Tool ${job.tool_name}${target ? ` for '${target}'` : ""} stale — retrying (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`);
            hasBlockingWork = true;
          } else if (job.status === "pending" || job.status === "running") {
            // Still working — keep waiting
            hasBlockingWork = true;
          }
        }

        if (shouldStop) {
          console.error(`\n  Agent stopped: ${stopReason}`);
          updateAgent(loadState(), agentId, (a) => { a.status = "stopped"; });
          break;
        }

        if (hasBlockingWork) {
          const toolNames = blockingJobs.map((j: any) => j.tool_name).join(", ");
          console.log(`  Agent waiting for tools: ${toolNames}`);
          updateAgent(loadState(), agentId, (a) => { a.status = "waiting_for_tool"; });
          await new Promise((r) => setTimeout(r, 30_000));
          // Restore to running only if not externally stopped
          const postWait = loadState().agents.find((a) => a.id === agentId);
          if (postWait?.status === "waiting_for_tool") {
            updateAgent(loadState(), agentId, (a) => { a.status = "running"; });
          }
          continue;
        }

        // Check for pending permission requests
        const pendingPerms = db.prepare(
          `SELECT * FROM permission_requests WHERE agent_id = ? AND status = 'pending' LIMIT 5`
        ).all(agentId) as any[];

        if (pendingPerms.length > 0) {
          const types = pendingPerms.map((p: any) => p.permission_type).join(", ");
          console.log(`  Agent blocked on permissions: ${types}`);
          updateAgent(loadState(), agentId, (a) => { a.status = "blocked_on_permission"; });
          await new Promise((r) => setTimeout(r, 30_000));
          // Restore to running only if not externally stopped
          const postWait = loadState().agents.find((a) => a.id === agentId);
          if (postWait?.status === "blocked_on_permission") {
            updateAgent(loadState(), agentId, (a) => { a.status = "running"; });
          }
          continue;
        }
      }

      // ── Bootstrap: discover players if none exist ──────────
      if (autonomous) {
        const { listPlayers } = await import("../data/game-store");
        if (listPlayers().length === 0) {
          console.log(`\n  No players in database. Bootstrapping via web search...`);
          const bootstrapped = await bootstrapPlayers(agentId);
          if (bootstrapped.length === 0) {
            console.log(`  Bootstrap failed — no players discovered. Retrying in 60s...`);
            waitRetries++;
            if (waitRetries >= MAX_WAIT_RETRIES) {
              console.log(`\n  Bootstrap failed after ${MAX_WAIT_RETRIES} retries. Agent stopping.`);
              break;
            }
            await new Promise((r) => setTimeout(r, 60_000));
            continue;
          }
          console.log(`  Bootstrapped ${bootstrapped.length} player(s): ${bootstrapped.join(", ")}`);
          waitRetries = 0;
        }
      }

      // ── Decision Step ──────────────────────────────────────
      let decision: AgentDecision;
      let decisionCost = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

      if (autonomous) {
        console.log(`\n  Making autonomous decision...`);
        const result: DecisionResult = await makeDecision(agentId, agentName, opts.researchBias ?? 0.5);
        decision = result.decision;
        decisionCost = {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
        };

        // Track decision cost on the agent
        if (decisionCost.costUsd > 0) {
          const ds = loadState();
          updateAgent(ds, agentId, (a) => {
            a.totalInputTokens += decisionCost.inputTokens;
            a.totalOutputTokens += decisionCost.outputTokens;
            a.totalCostUsd += decisionCost.costUsd;
          });
        }

        console.log(`  Decision: ${decision.action} — ${decision.reasoning}`);
      } else {
        // Fixed mode: always start_new with configured players/focus
        decision = {
          action: "start_new",
          players: opts.players!,
          focus: opts.focus!,
          reasoning: "Fixed mode — using configured players and focus",
        };
      }

      // ── Handle "wait" action ───────────────────────────────
      if (decision.action === "wait") {
        waitRetries++;
        if (waitRetries >= MAX_WAIT_RETRIES) {
          console.log(`\n  No player data after ${MAX_WAIT_RETRIES} retries. Agent stopping.`);
          break;
        }
        console.log(`  Waiting 60s before retrying (attempt ${waitRetries}/${MAX_WAIT_RETRIES})...`);
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        continue;
      }

      // Reset wait counter on successful decision
      waitRetries = 0;
      sessionNumber++;
      const sessionStartedAt = new Date().toISOString();

      console.log(`\n  ══════════════════════════════════════════`);
      console.log(`  Agent "${agentName}" — Session #${sessionNumber}`);
      console.log(`  Action: ${decision.action} | Players: ${decision.players.join(", ")} | Focus: ${decision.focus}`);
      console.log(`  ══════════════════════════════════════════\n`);

      // ── Handle review_paper (lightweight — no full session for peer review)
      if (decision.action === "review_paper" && decision.reviewPaperId) {
        const handled = await handlePaperReview(agentId, agentName, decision.reviewPaperId);
        if (handled) {
          // Peer review completed (not author's paper) — continue to next decision
          continue;
        }
        // Author's own paper needing revision → fall through to start a new session
        // with the paper's branch as the starting point
        console.log(`  Starting revision session for paper ${decision.reviewPaperId}...`);
        const paperForRevision = getPaper(decision.reviewPaperId);
        if (paperForRevision) {
          decision = {
            action: "start_new",
            players: decision.players,
            focus: decision.focus || "accuracy",
            reasoning: `Revision session for paper "${paperForRevision.title}" — addressing reviewer feedback`,
          };
        }
      }

      // ── Execute decision ───────────────────────────────────
      let result: { session: ForgeSession | null };

      if (decision.action === "resume_session" && decision.resumeSessionId) {
        result = await resumeAgentSession(
          agentId,
          agentName,
          decision,
          opts,
        );
      } else if (decision.action === "join_session" && decision.joinSessionId) {
        // Reassign the session to this agent, then resume it
        const joinState = loadState();
        const joinSession = joinState.sessions.find((s) => s.id === decision.joinSessionId);
        if (joinSession) {
          console.log(`  Joining session "${joinSession.name}" (previously owned by agent ${joinSession.agentId?.slice(0, 8) ?? "none"})...`);
          updateSession(joinState, joinSession.id, (s) => {
            s.agentId = agentId;
          });
          // Use resumeAgentSession with the join session ID mapped to resumeSessionId
          const resumeDecision: AgentDecision = {
            ...decision,
            action: "resume_session",
            resumeSessionId: decision.joinSessionId,
          };
          result = await resumeAgentSession(
            agentId,
            agentName,
            resumeDecision,
            opts,
          );
        } else {
          console.log(`  ⚠ Join target session ${decision.joinSessionId} not found. Starting new session...`);
          result = { session: null };
        }
      } else {
        // Download player data for this session's players
        const validPlayers = await downloadPlayers(decision.players);
        if (validPlayers.length === 0) {
          console.log(`\n  No valid players for this session. Trying next decision...`);
          continue;
        }

        result = await runAgentSession(
          agentId,
          agentName,
          validPlayers,
          decision.focus,
          opts,
          sessionStartedAt,
          decision,
        );
      }

      if (!result.session) {
        console.log(`\n  Session failed to start. Trying next decision...`);
        continue;
      }

      // Record results to SQLite leaderboard
      recordSessionToLeaderboard(
        agentId,
        agentName,
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
          decision,
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
    if (
      finalAgent &&
      (finalAgent.status === "running" ||
       finalAgent.status === "waiting_for_tool" ||
       finalAgent.status === "blocked_on_permission")
    ) {
      updateAgent(finalState, agentId, (a) => {
        a.status = "stopped";
      });
    }
    removeAgentPid(agentId);
    console.log(`\n  Agent stopped.`);
  }
}

/**
 * Download player data for the given usernames.
 * Returns only the usernames that were successfully fetched with games.
 */
async function downloadPlayers(usernames: string[]): Promise<string[]> {
  const { fetchPlayer, getGames } = await import("../data/game-store");

  console.log(`  Downloading data for ${usernames.length} player(s)...\n`);
  const validPlayers: string[] = [];
  for (const username of usernames) {
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
  return validPlayers;
}

/**
 * Bootstrap player data when none exists.
 * Searches the web for Lichess usernames + hits the Lichess leaderboard API,
 * then fetches player profiles/games. Logs steps as tool_jobs for dashboard.
 */
async function bootstrapPlayers(agentId: string): Promise<string[]> {
  const { createWebTools } = await import("../tools/web-tools");
  const { fetchPlayer, getGames } = await import("../data/game-store");
  const { getForgeDb } = await import("../state/forge-db");
  const { randomUUID } = await import("node:crypto");

  const webTools = createWebTools();
  const db = getForgeDb();

  function logJob(toolName: string, input: unknown): string {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO tool_jobs (id, session_id, agent_id, tool_name, status, input, created_at, blocking, retry_count)
       VALUES (?, 'bootstrap', ?, ?, 'running', ?, ?, 0, 0)`
    ).run(id, agentId, toolName, JSON.stringify(input), new Date().toISOString());
    return id;
  }

  function completeJob(id: string, output: string) {
    db.prepare(
      `UPDATE tool_jobs SET status = 'completed', output = ?, completed_at = ? WHERE id = ?`
    ).run(output.slice(0, 10000), new Date().toISOString(), id);
  }

  function failJob(id: string, error: string) {
    db.prepare(
      `UPDATE tool_jobs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`
    ).run(error, new Date().toISOString(), id);
  }

  // ── Step 1: Discover usernames via web search ──

  const queries = [
    "lichess player 1500 rating profile site:lichess.org/@",
    "lichess 1200 elo player rapid site:lichess.org/@",
    "lichess intermediate player classical games site:lichess.org/@",
  ];

  const discovered = new Map<string, number | null>(); // username → rating hint
  const PROFILE_RE = /lichess\.org\/@\/([A-Za-z0-9_-]{2,20})/g;
  const EXCLUDED = new Set([
    "lichess", "api", "team", "tournament", "swiss", "broadcast", "tv", "forum",
  ]);

  for (const query of queries) {
    const jobId = logJob("bootstrap_search", { query });
    try {
      console.log(`    Searching: "${query}"`);
      const results = await webTools.search(query);
      const found: string[] = [];
      for (const r of results) {
        const text = `${r.url} ${r.snippet} ${r.title}`;
        let match: RegExpExecArray | null;
        PROFILE_RE.lastIndex = 0;
        while ((match = PROFILE_RE.exec(text)) !== null) {
          const name = match[1];
          if (!EXCLUDED.has(name.toLowerCase()) && !discovered.has(name)) {
            discovered.set(name, null);
            found.push(name);
          }
        }
      }
      completeJob(jobId, JSON.stringify({ results: results.length, usernames: found }));
      console.log(`    Found ${found.length} username(s)`);
    } catch (err) {
      failJob(jobId, (err as Error).message);
      console.warn(`    Search failed: ${(err as Error).message}`);
    }
  }

  // ── Step 2: Lichess rating-capped tournaments for diverse Elo ──
  //
  // Fetch players from active rating-capped arenas (≤1500, ≤2000, etc.)
  // instead of the top leaderboard, to get lower-rated players that are
  // more valuable for Maia-style research.

  const jobId2 = logJob("bootstrap_tournament", { source: "lichess arena API" });
  try {
    console.log(`    Fetching Lichess tournaments for diverse-rated players...`);
    const res = await fetch("https://lichess.org/api/tournament", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json() as {
        started?: { id: string; fullName: string; nbPlayers: number }[];
      };
      // Find rating-capped tournaments with enough players
      const capped = (data.started ?? [])
        .filter((t) => /≤\d+/.test(t.fullName) && t.nbPlayers >= 20)
        .sort((a, b) => b.nbPlayers - a.nbPlayers)
        .slice(0, 3);

      let totalFound = 0;
      for (const t of capped) {
        try {
          const tRes = await fetch(
            `https://lichess.org/api/tournament/${t.id}/results?nb=10`,
            { headers: { Accept: "application/x-ndjson" }, signal: AbortSignal.timeout(10_000) },
          );
          if (tRes.ok) {
            const lines = (await tRes.text()).trim().split("\n").filter(Boolean);
            for (const line of lines) {
              const p = JSON.parse(line) as { username: string; rating: number };
              if (p.username && !EXCLUDED.has(p.username.toLowerCase()) && !discovered.has(p.username)) {
                discovered.set(p.username, p.rating);
                totalFound++;
              }
            }
          }
        } catch { /* skip individual tournament failures */ }
      }
      completeJob(jobId2, JSON.stringify({ tournaments: capped.length, players: totalFound }));
      console.log(`    Tournaments: ${totalFound} player(s) from ${capped.length} arena(s)`);
    } else {
      failJob(jobId2, `HTTP ${res.status}`);
    }
  } catch (err) {
    failJob(jobId2, (err as Error).message);
    console.warn(`    Tournament fetch failed: ${(err as Error).message}`);
  }

  if (discovered.size === 0) {
    console.log("    No usernames discovered.");
    return [];
  }

  // ── Step 3: Select diverse candidates, preferring lower-rated players ──
  //
  // Lower-rated players (1200-2000) are more valuable for Maia-style
  // research since Stockfish depth differences matter less and human
  // move patterns are more distinctive.

  const entries = Array.from(discovered.entries());
  // Sort: known ratings first (ascending — lower rated first), unknown last
  entries.sort((a, b) => {
    if (a[1] != null && b[1] != null) return a[1] - b[1];
    if (a[1] != null) return -1;
    if (b[1] != null) return 1;
    return 0;
  });
  const candidates = entries.slice(0, 5).map(([name]) => name);
  console.log(`    Candidates: ${candidates.join(", ")}`);

  const valid: string[] = [];
  for (const username of candidates) {
    const jobId = logJob("bootstrap_fetch_player", { username });
    try {
      console.log(`    Fetching ${username} from Lichess...`);
      const data = await fetchPlayer(username);
      const games = getGames(username);
      if (games.length === 0) {
        failJob(jobId, "0 games found");
        console.log(`    [${username}] 0 games — skipped`);
      } else {
        completeJob(jobId, JSON.stringify({ elo: data.estimatedElo, games: games.length }));
        console.log(`    [${username}] ✓ ${games.length} games (Elo: ${data.estimatedElo})`);
        valid.push(username);
      }
    } catch (err) {
      failJob(jobId, (err as Error).message);
      console.warn(`    [${username}] Failed: ${(err as Error).message}`);
    }
  }

  return valid;
}

/**
 * Run a single NEW research session for an agent.
 */
async function runAgentSession(
  agentId: string,
  agentName: string,
  players: string[],
  focus: string,
  opts: AgentOptions,
  _startedAt: string,
  decision?: AgentDecision,
): Promise<{ session: ForgeSession | null }> {
  const state = loadState();
  const costTracker = new CostTracker();
  const sessionId = randomUUID();

  // Build player ELO map for semantic naming
  const playerElos = await getPlayerEloMap(players);
  const sessionName = buildSessionName(players, focus, state, playerElos);
  const logWriter = createLogWriter(sessionName, sessionId);

  const log = (msg: string, level: "info" | "warn" | "error" = "info") => {
    if (level === "error") console.error(msg);
    else if (level === "warn") console.warn(msg);
    else console.log(msg);
    logWriter.log(msg, level);
  };

  log(`  Session: ${sessionName}`);
  log(`  Session ID: ${sessionId.slice(0, 8)}`);
  log(`  Focus: ${focus}`);
  log(``);

  // Create sandbox (git worktree)
  log("  Creating sandbox...");
  const sandbox = createSandbox(sessionId);
  log(`  Sandbox: ${sandbox.worktreePath}`);

  // Initialize OS-level sandbox runtime for subprocess isolation
  const permissions = defaultPermissions(sandbox.worktreePath);
  await initSandboxRuntime(permissions);

  // Create session record
  const session: ForgeSession = {
    id: sessionId,
    name: sessionName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
    agentId,
    worktreeBranch: sandbox.branchName,
    focus,
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

  // Update agent's current session
  updateAgent(state, agentId, (a) => {
    a.currentSessionId = sessionId;
  });

  // Build player data
  const playerData = await buildPlayerData(players, opts.seed);

  // Create REPL and inject forge API
  const repl = createReplServer();
  repl.inject("playerData", playerData);

  const forgeApi = createForgeApi(sandbox, session, state, playerData);
  const sessionStartedAt = new Date().toISOString();
  injectAgentExtensions(forgeApi, agentId, agentName, session, sessionStartedAt);
  repl.inject("forge", forgeApi);

  const agent = state.agents.find((a) => a.id === agentId);
  const promptCtx = {
    session,
    state,
    baseline: session.baseline,
    focus,
    maxExperiments: opts.maxExperiments,
    agent,
    decision,
    researchBias: opts.researchBias ?? 0.5,
  };

  const researchOpts = {
    name: sessionName,
    players,
    focus,
    maxExperiments: opts.maxExperiments,
    seed: opts.seed,
    quick: opts.quick,
    researchBias: opts.researchBias,
  };

  const initialMessage = buildInitialMessage(researchOpts, playerData);

  try {
    await runAgentLoop(
      client(),
      repl,
      session,
      state,
      promptCtx,
      initialMessage,
      costTracker,
      researchOpts,
      logWriter,
      forgeApi,
      sandbox,
    );
  } catch (err) {
    log(`\n  ✗ Session error: ${err}`, "error");
    updateSession(state, sessionId, (s) => {
      s.status = "paused";
    });
  } finally {
    repl.dispose();
    await resetSandboxRuntime();
    if (session.status === "completed" || session.status === "abandoned") {
      try { commitSandbox(sandbox, `forge: safety commit before destroy for ${session.name}`); } catch { /* sandbox may already be clean */ }

      // Generate paper and push branch
      await generateAndPushPaper(session, sandbox, agentId, agentName);

      destroySandbox(sandbox);
    }
  }

  logWriter.close();
  return { session };
}

/**
 * Resume an existing paused session for an agent (autonomous decision).
 * Finds the sandbox, re-creates REPL + forge API, and continues.
 */
async function resumeAgentSession(
  agentId: string,
  agentName: string,
  decision: AgentDecision,
  opts: AgentOptions,
): Promise<{ session: ForgeSession | null }> {
  const state = loadState();
  const session = state.sessions.find((s) => s.id === decision.resumeSessionId);
  if (!session) {
    console.log(`  ✗ Session ${decision.resumeSessionId} not found.`);
    return { session: null };
  }

  // Find the sandbox
  const sandboxes = listSandboxes();
  const sandbox = sandboxes.find((s) => s.sessionId === session.id);
  if (!sandbox) {
    console.log(`  ✗ Sandbox not found for session ${session.id.slice(0, 8)}.`);
    return { session: null };
  }

  const costTracker = new CostTracker();
  const logWriter = createLogWriter(session.name, session.id);
  const log = (msg: string, level: "info" | "warn" | "error" = "info") => {
    if (level === "error") console.error(msg);
    else if (level === "warn") console.warn(msg);
    else console.log(msg);
    logWriter.log(msg, level);
  };

  // Initialize OS-level sandbox runtime for subprocess isolation
  const permissions = defaultPermissions(sandbox.worktreePath);
  await initSandboxRuntime(permissions);

  log(`  Resuming session: ${session.name}`);
  log(`  Experiments so far: ${session.experiments.length}`);

  // Recreate REPL and rebuild player data
  const repl = createReplServer();
  const playerData = await buildPlayerData(session.players, opts.seed);
  repl.inject("playerData", playerData);

  const forgeApi = createForgeApi(sandbox, session, state, playerData);
  const sessionStartedAt = session.createdAt ?? new Date().toISOString();
  injectAgentExtensions(forgeApi, agentId, agentName, session, sessionStartedAt);
  repl.inject("forge", forgeApi);

  const focus = session.focus ?? "accuracy";
  const agent = state.agents.find((a) => a.id === agentId);
  const promptCtx = {
    session,
    state,
    baseline: session.baseline,
    focus,
    maxExperiments: opts.maxExperiments,
    agent,
    decision,
    researchBias: opts.researchBias ?? 0.5,
  };

  // Resume message
  const resumeMessage =
    `Resuming session "${session.name}". ` +
    `${session.experiments.length} experiments completed so far. ` +
    `${session.activeChanges.length} code changes currently applied. ` +
    `Decision reasoning: ${decision.reasoning}. ` +
    `Continue the research from where you left off.`;

  updateSession(state, session.id, (s) => {
    s.status = "active";
  });

  // Update agent's current session
  updateAgent(state, agentId, (a) => {
    a.currentSessionId = session.id;
  });

  try {
    await runAgentLoop(
      client(),
      repl,
      session,
      state,
      promptCtx,
      resumeMessage,
      costTracker,
      {
        name: session.name,
        focus,
        maxExperiments: opts.maxExperiments,
        seed: opts.seed,
        quick: opts.quick,
        researchBias: opts.researchBias,
      },
      logWriter,
      forgeApi,
      sandbox,
    );
  } catch (err) {
    log(`\n  ✗ Session error: ${err}`, "error");
    updateSession(state, session.id, (s) => {
      s.status = "paused";
    });
  } finally {
    repl.dispose();
    await resetSandboxRuntime();
    if (session.status === "completed" || session.status === "abandoned") {
      try { commitSandbox(sandbox, `forge: safety commit before destroy for ${session.name}`); } catch { /* sandbox may already be clean */ }

      // Generate paper and push branch
      await generateAndPushPaper(session, sandbox, agentId, agentName);

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

/**
 * Inject leaderboard (read-only), feature request callback, and
 * incremental leaderboard update hook onto the forge API.
 * These bypass the ForgeApi type intentionally — agents cannot write to
 * the leaderboard, only the agent-manager writes.
 */
function injectAgentExtensions(
  forgeApi: any,
  agentId: string,
  agentName: string,
  session: ForgeSession,
  sessionStartedAt: string,
): void {
  forgeApi.leaderboard = {
    get: () => getLeaderboard(),
    me: () => getAgentStats(agentId),
  };
  forgeApi.request = (
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

  // Update leaderboard after every experiment (incremental)
  forgeApi._onExperimentRecorded = () => {
    recordSessionToLeaderboard(agentId, agentName, session, sessionStartedAt);
  };
}

/**
 * Generate a research paper, write it to the sandbox, and push the branch.
 * Called after session completion (both new and resumed sessions).
 */
async function generateAndPushPaper(
  session: ForgeSession,
  sandbox: { worktreePath: string; branchName: string },
  agentId: string,
  agentName: string,
): Promise<void> {
  try {
    console.log(`  📝 Generating research paper...`);
    const paper = await generatePaper(session, agentId, agentName, sandbox.branchName);

    // Write paper.md to the git worktree
    writeFileSync(join(sandbox.worktreePath, "paper.md"), paper.content, "utf-8");
    commitSandbox(sandbox as any, `forge: add research paper "${paper.title}"`);

    // Determine status based on improvement
    const baselineComposite = session.baseline?.aggregate?.compositeScore ?? 0;
    const bestComposite = session.bestResult?.compositeScore ?? 0;
    const delta = bestComposite - baselineComposite;

    if (delta > 0) {
      updatePaper(paper.id, { status: "submitted", submittedAt: new Date().toISOString() });
      console.log(`  📄 Paper "${paper.title}" submitted for review (Δ +${delta.toFixed(4)})`);
    } else {
      updatePaper(paper.id, { status: "abandoned" });
      console.log(`  📄 Paper "${paper.title}" auto-abandoned (no improvement)`);
    }

    // Always push — paper + code need to be on the remote
    try {
      pushBranch(sandbox.branchName);
      console.log(`  ✓ Pushed branch ${sandbox.branchName}`);
    } catch (pushErr) {
      console.log(`  ⚠ Push failed for ${sandbox.branchName}: ${pushErr}`);
    }
  } catch (paperErr) {
    console.warn(`  ⚠ Paper generation failed: ${paperErr}`);

    // Fallback: push positive results without paper
    if (session.status === "completed" && session.bestResult && session.baseline) {
      const baselineComposite = session.baseline.aggregate?.compositeScore ?? 0;
      const delta = session.bestResult.compositeScore - baselineComposite;
      if (delta >= 0.01) {
        try {
          pushBranch(sandbox.branchName);
          console.log(`  ✓ Auto-pushed branch ${sandbox.branchName} (composite Δ +${delta.toFixed(4)})`);
        } catch (err) {
          console.log(`  ⚠ Auto-push failed for ${sandbox.branchName}: ${err}`);
        }
      }
    }
  }
}

/**
 * Handle a "review_paper" decision. If the agent is NOT the author,
 * generate a peer review. If both reviews are in, adjudicate.
 * Returns true if a review was performed (no full session needed).
 */
async function handlePaperReview(
  agentId: string,
  agentName: string,
  paperId: string,
): Promise<boolean> {
  const paper = getPaper(paperId);
  if (!paper) {
    console.log(`  ⚠ Paper ${paperId} not found.`);
    return false;
  }

  // ── Author's own paper needing revision → needs a full session
  if (paper.agentId === agentId) {
    console.log(`  📝 Paper "${paper.title}" is your own — starting revision session...`);
    return false; // Caller will handle as a full session
  }

  // ── Peer review by a different agent
  const existingReviews = getReviewCountForPaper(paper.id, paper.submissionCount);
  if (existingReviews >= 2) {
    console.log(`  ⚠ Paper "${paper.title}" already has 2 reviews for round ${paper.submissionCount}.`);
    return true;
  }

  console.log(`  🔍 Reviewing paper "${paper.title}" by ${paper.agentName}...`);

  // Update paper status
  if (paper.status === "submitted") {
    updatePaper(paper.id, { status: "under_review" });
  }

  const review = await generateReview(paper, agentId, agentName, paper.submissionCount);
  insertReview(review);

  console.log(`  ✓ Review submitted: ${review.recommendation} (${review.strengths.length} strengths, ${review.weaknesses.length} weaknesses)`);

  // Check if we now have 2 reviews → adjudicate
  const allReviews = getReviewsForPaper(paper.id, paper.submissionCount);
  if (allReviews.length >= 2) {
    const result = adjudicateReviews(allReviews);
    console.log(`  📋 Adjudication: ${result.outcome} — ${result.reason}`);

    if (result.outcome === "accepted") {
      updatePaper(paper.id, { status: "accepted", acceptedAt: new Date().toISOString() });
    } else if (result.outcome === "rejected") {
      updatePaper(paper.id, { status: "rejected", rejectedAt: new Date().toISOString() });
    } else if (result.outcome === "needs_revision") {
      if (paper.submissionCount >= 3) {
        updatePaper(paper.id, { status: "rejected", rejectedAt: new Date().toISOString() });
        console.log(`  ⛔ Paper rejected after 3 submissions.`);
      }
      // Otherwise, paper stays "under_review" — author picks it up via decision step
    }
  }

  return true;
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

  // Check if session had any code changes (config-only sessions get penalized)
  const hasCodeChanges = session.experiments.some(
    (e) => (e.codeChanges?.length ?? 0) > 0
  ) || (session.activeChanges?.length ?? 0) > 0;
  const isConfigOnly = !hasCodeChanges;

  recordSessionResult({
    id: `${agentId}:${session.id}`,
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
    isConfigOnly,
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

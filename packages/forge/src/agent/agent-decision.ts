/**
 * Agent Decision Module — LLM-powered decision step for autonomous agents.
 *
 * Before each session, the agent calls Claude with full context (leaderboard,
 * past sessions, available players, knowledge base, resumable sessions) and
 * receives a structured JSON decision about what to work on next.
 */

import Anthropic from "@anthropic-ai/sdk";
import { loadState } from "../state/forge-state.js";
import { getLeaderboard } from "../state/leaderboard-db.js";
import { listPlayers } from "../data/game-store.js";
import { loadNotes } from "../knowledge/index.js";
import { listSandboxes } from "../repl/sandbox.js";
import type {
  AgentDecision,
  ForgeSession,
  LeaderboardEntry,
  PlayerData,
} from "../state/types.js";

/** Focus areas the agent can choose from */
const VALID_FOCUS_AREAS = [
  "accuracy",
  "cpl",
  "blunders",
  "opening",
  "middlegame",
  "endgame",
];

interface DecisionContext {
  agentId: string;
  agentName: string;
  players: PlayerData[];
  sessions: ForgeSession[];
  leaderboard: LeaderboardEntry[];
  notes: { tags: string[]; content: string }[];
  resumableSessions: { sessionId: string; sessionName: string; focus: string; players: string[]; experimentCount: number; bestComposite: number | null }[];
  exploredFocusAreas: Map<string, number>; // focus → count of sessions
}

function gatherContext(agentId: string, agentName: string): DecisionContext {
  const state = loadState();
  const players = listPlayers();
  const leaderboard = getLeaderboard();
  const notes = loadNotes({ limit: 10 });
  const sandboxes = listSandboxes();

  // Find paused sessions that have intact sandboxes (resumable)
  const sandboxSessionIds = new Set(sandboxes.map((s) => s.sessionId));
  const resumableSessions = state.sessions
    .filter(
      (s) =>
        s.status === "paused" &&
        sandboxSessionIds.has(s.id) &&
        s.agentId === agentId
    )
    .map((s) => ({
      sessionId: s.id,
      sessionName: s.name,
      focus: s.focus,
      players: s.players,
      experimentCount: s.experiments.length,
      bestComposite: s.bestResult?.compositeScore ?? null,
    }));

  // Count explored focus areas across all sessions
  const exploredFocusAreas = new Map<string, number>();
  for (const s of state.sessions) {
    const focus = s.focus ?? "accuracy";
    exploredFocusAreas.set(focus, (exploredFocusAreas.get(focus) ?? 0) + 1);
  }

  return {
    agentId,
    agentName,
    players,
    sessions: state.sessions,
    leaderboard,
    notes: notes.map((n) => ({ tags: n.tags, content: n.content })),
    resumableSessions,
    exploredFocusAreas,
  };
}

function buildDecisionPrompt(ctx: DecisionContext): string {
  const sections: string[] = [];

  sections.push(
    `You are "${ctx.agentName}", an autonomous chess research agent competing on a leaderboard.\nYou must decide what to work on next.\n`
  );

  // Available players
  if (ctx.players.length === 0) {
    sections.push("## Available Players\nNo player data available.\n");
  } else {
    const playerLines = ctx.players.map(
      (p) => `- ${p.username} (Elo ~${p.estimatedElo}, ${p.gameCount} games)`
    );
    sections.push(`## Available Players\n${playerLines.join("\n")}\n`);
  }

  // This agent's past sessions
  const mySessions = ctx.sessions.filter(
    (s) => s.agentId === ctx.agentId
  );
  if (mySessions.length > 0) {
    const sessionLines = mySessions.map((s) => {
      const best = s.bestResult
        ? `best composite ${s.bestResult.compositeScore.toFixed(3)}`
        : "no results";
      return `- ${s.name} [${s.status}] — focus: ${s.focus ?? "accuracy"}, players: ${s.players.join(", ")}, ${s.experiments.length} experiments, ${best}`;
    });
    sections.push(
      `## Your Past Sessions\n${sessionLines.join("\n")}\n`
    );
  } else {
    sections.push("## Your Past Sessions\nThis is your first session.\n");
  }

  // Resumable sessions
  if (ctx.resumableSessions.length > 0) {
    const resumeLines = ctx.resumableSessions.map((s) => {
      const best = s.bestComposite !== null
        ? `best composite ${s.bestComposite.toFixed(3)}`
        : "no results yet";
      return `- ${s.sessionName} (id: ${s.sessionId}) — focus: ${s.focus}, players: ${s.players.join(", ")}, ${s.experimentCount} experiments, ${best}`;
    });
    sections.push(
      `## Resumable Sessions (paused with intact sandboxes)\n${resumeLines.join("\n")}\n`
    );
  }

  // Leaderboard
  if (ctx.leaderboard.length > 0) {
    const lbLines = ctx.leaderboard.map(
      (e) =>
        `#${e.rank} ${e.agentName} — avg weighted Δ: ${e.avgWeightedCompositeDelta.toFixed(4)}, accuracy Δ: ${e.avgAccuracyDelta.toFixed(4)}, ${e.sessionsCount} sessions`
    );
    sections.push(`## Leaderboard\n${lbLines.join("\n")}\n`);
  } else {
    sections.push("## Leaderboard\nNo entries yet — you'll be the first!\n");
  }

  // Knowledge notes
  if (ctx.notes.length > 0) {
    const noteLines = ctx.notes.map(
      (n) => `- [${n.tags.join(", ")}] ${n.content.slice(0, 200)}`
    );
    sections.push(
      `## Recent Knowledge Notes\n${noteLines.join("\n")}\n`
    );
  }

  // Explored / unexplored focus areas
  const explored = Array.from(ctx.exploredFocusAreas.entries())
    .map(([f, c]) => `${f} (${c} sessions)`)
    .join(", ");
  const unexplored = VALID_FOCUS_AREAS.filter(
    (f) => !ctx.exploredFocusAreas.has(f)
  );
  sections.push(
    `## Focus Areas\nExplored: ${explored || "none"}\nUnexplored: ${unexplored.length > 0 ? unexplored.join(", ") : "all explored"}\nValid areas: ${VALID_FOCUS_AREAS.join(", ")}\n`
  );

  // Decision rules
  sections.push(`## Decision Rules
1. If a paused session has promising unfinished work, prefer RESUMING it.
2. Diversify: pick focus areas and players that haven't been explored much.
3. If behind on the leaderboard, consider a "groundbreaking" exploratory approach.
4. You can combine multiple focus areas with commas (e.g., "accuracy,opening").
5. If no players are available, output action "wait".
6. Pick 1-3 players per session — don't use all players every time.

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "action": "start_new" | "resume_session" | "wait",
  "players": ["username1", "username2"],
  "focus": "accuracy",
  "resumeSessionId": "session-id-here",
  "reasoning": "Brief explanation of why this choice"
}`);

  return sections.join("\n");
}

function validateDecision(
  raw: Record<string, unknown>,
  ctx: DecisionContext
): AgentDecision {
  const action = raw.action as string;
  const playerNames = new Set(ctx.players.map((p) => p.username));

  if (action === "wait") {
    return {
      action: "wait",
      players: [],
      focus: "accuracy",
      reasoning: String(raw.reasoning ?? "No players available"),
    };
  }

  // Validate players
  let players = Array.isArray(raw.players)
    ? (raw.players as string[]).filter((p) => playerNames.has(p))
    : [];
  if (players.length === 0 && ctx.players.length > 0) {
    // Default to first player
    players = [ctx.players[0].username];
  }

  // Validate focus
  let focus = String(raw.focus ?? "accuracy");
  const focusParts = focus.split(",").map((s) => s.trim()).filter(Boolean);
  const validParts = focusParts.filter((f) => VALID_FOCUS_AREAS.includes(f));
  focus = validParts.length > 0 ? validParts.join(",") : "accuracy";

  const reasoning = String(raw.reasoning ?? "Autonomous decision");

  if (action === "resume_session") {
    const resumeId = String(raw.resumeSessionId ?? "");
    const resumable = ctx.resumableSessions.find(
      (s) => s.sessionId === resumeId
    );
    if (resumable) {
      return {
        action: "resume_session",
        players: resumable.players,
        focus: resumable.focus,
        resumeSessionId: resumeId,
        reasoning,
      };
    }
    // Fallback to start_new if session not resumable
    console.log(
      `  ⚠ Session ${resumeId} not resumable, falling back to start_new`
    );
  }

  return {
    action: "start_new",
    players,
    focus,
    reasoning,
  };
}

export interface DecisionResult {
  decision: AgentDecision;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Make an autonomous decision about what to work on next.
 * Calls Claude with full context and returns a structured decision.
 */
export async function makeDecision(
  agentId: string,
  agentName: string
): Promise<DecisionResult> {
  const ctx = gatherContext(agentId, agentName);

  // If no players available, return wait immediately (no LLM call needed)
  if (ctx.players.length === 0) {
    return {
      decision: {
        action: "wait",
        players: [],
        focus: "accuracy",
        reasoning: "No player data available",
      },
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }

  const prompt = buildDecisionPrompt(ctx);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback: pick first player + accuracy if no API key
    console.log("  ⚠ No ANTHROPIC_API_KEY — using default decision");
    return {
      decision: {
        action: "start_new",
        players: [ctx.players[0].username],
        focus: "accuracy",
        reasoning: "Default fallback (no API key)",
      },
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // Parse JSON from response (handle markdown code fences)
    const jsonStr = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(jsonStr);
    const decision = validateDecision(parsed, ctx);

    // Cost: Sonnet ~$3/M input, ~$15/M output
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUsd =
      (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;

    return { decision, inputTokens, outputTokens, costUsd };
  } catch (err) {
    console.error("  ⚠ Decision LLM call failed:", err);
    // Fallback: pick first player + accuracy
    return {
      decision: {
        action: "start_new",
        players: [ctx.players[0].username],
        focus: "accuracy",
        reasoning: `Fallback after error: ${String(err)}`,
      },
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }
}

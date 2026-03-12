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
import { listPapers, getPapersNeedingReview, getPapersNeedingRevision, getReviewsForPaper } from "../papers/paper-db.js";
import type { Paper } from "../papers/paper-types.js";

/** Focus areas the agent can choose from */
const VALID_FOCUS_AREAS = [
  "accuracy",
  "cpl",
  "blunders",
  "opening",
  "middlegame",
  "endgame",
];

interface SessionSummaryForDecision {
  sessionId: string;
  sessionName: string;
  focus: string;
  players: string[];
  experimentCount: number;
  bestComposite: number | null;
  status: string;
  agentId: string | null;
}

interface PaperSummaryForDecision {
  paperId: string;
  title: string;
  authorAgentName: string;
  authorAgentId: string;
  compositeDelta: number;
  submissionCount: number;
  reviewCount: number;
}

interface DecisionContext {
  agentId: string;
  agentName: string;
  players: PlayerData[];
  sessions: ForgeSession[];
  leaderboard: LeaderboardEntry[];
  notes: { tags: string[]; content: string }[];
  resumableSessions: SessionSummaryForDecision[];
  /** Any paused/completed session the agent could join (not just its own) */
  availableSessions: SessionSummaryForDecision[];
  exploredFocusAreas: Map<string, number>; // focus → count of sessions
  /** Papers needing peer review (authored by other agents) */
  papersNeedingReview: PaperSummaryForDecision[];
  /** This agent's papers that have revision feedback */
  papersNeedingRevision: PaperSummaryForDecision[];
  /** Recent accepted/submitted papers (for literature awareness) */
  recentPapers: PaperSummaryForDecision[];
}

function gatherContext(agentId: string, agentName: string): DecisionContext {
  const state = loadState();
  const players = listPlayers();
  const leaderboard = getLeaderboard();
  const notes = loadNotes({ limit: 10 });
  const sandboxes = listSandboxes();

  // Find paused sessions that have intact sandboxes (resumable by this agent)
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
      status: s.status,
      agentId: s.agentId,
    }));

  // Available sessions to join: any paused session with a sandbox (regardless of owner)
  // Exclude sessions already in resumableSessions (agent's own)
  const resumableIds = new Set(resumableSessions.map((s) => s.sessionId));
  const availableSessions = state.sessions
    .filter(
      (s) =>
        s.status === "paused" &&
        sandboxSessionIds.has(s.id) &&
        !resumableIds.has(s.id)
    )
    .map((s) => ({
      sessionId: s.id,
      sessionName: s.name,
      focus: s.focus,
      players: s.players,
      experimentCount: s.experiments.length,
      bestComposite: s.bestResult?.compositeScore ?? null,
      status: s.status,
      agentId: s.agentId,
    }));

  // Count explored focus areas across all sessions
  const exploredFocusAreas = new Map<string, number>();
  for (const s of state.sessions) {
    const focus = s.focus ?? "accuracy";
    exploredFocusAreas.set(focus, (exploredFocusAreas.get(focus) ?? 0) + 1);
  }

  // Papers needing peer review (not authored by this agent)
  const papersForReview = getPapersNeedingReview(agentId);
  const papersNeedingReview: PaperSummaryForDecision[] = papersForReview.map((p) => ({
    paperId: p.id,
    title: p.title,
    authorAgentName: p.agentName,
    authorAgentId: p.agentId,
    compositeDelta: p.compositeDelta,
    submissionCount: p.submissionCount,
    reviewCount: getReviewsForPaper(p.id, p.submissionCount).length,
  }));

  // This agent's papers needing revision
  const revisionPapers = getPapersNeedingRevision(agentId);
  const papersNeedingRevision: PaperSummaryForDecision[] = revisionPapers.map((p) => ({
    paperId: p.id,
    title: p.title,
    authorAgentName: p.agentName,
    authorAgentId: p.agentId,
    compositeDelta: p.compositeDelta,
    submissionCount: p.submissionCount,
    reviewCount: p.reviews.length,
  }));

  // Recent papers for literature awareness
  const acceptedPapers = listPapers({ status: "accepted" });
  const submittedPapers = listPapers({ status: "submitted" });
  const recentPapers: PaperSummaryForDecision[] = [...acceptedPapers, ...submittedPapers]
    .slice(0, 10)
    .map((p) => ({
      paperId: p.id,
      title: p.title,
      authorAgentName: p.agentName,
      authorAgentId: p.agentId,
      compositeDelta: p.compositeDelta,
      submissionCount: p.submissionCount,
      reviewCount: getReviewsForPaper(p.id, p.submissionCount).length,
    }));

  return {
    agentId,
    agentName,
    players,
    sessions: state.sessions,
    leaderboard,
    notes: notes.map((n) => ({ tags: n.tags, content: n.content })),
    resumableSessions,
    availableSessions,
    exploredFocusAreas,
    papersNeedingReview,
    papersNeedingRevision,
    recentPapers,
  };
}

function buildDecisionPrompt(ctx: DecisionContext, researchBias: number = 0.5): string {
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

  // Resumable sessions (agent's own)
  if (ctx.resumableSessions.length > 0) {
    const resumeLines = ctx.resumableSessions.map((s) => {
      const best = s.bestComposite !== null
        ? `best composite ${s.bestComposite.toFixed(3)}`
        : "no results yet";
      return `- ${s.sessionName} (id: ${s.sessionId}) — focus: ${s.focus}, players: ${s.players.join(", ")}, ${s.experimentCount} experiments, ${best}`;
    });
    sections.push(
      `## Your Resumable Sessions (paused with intact sandboxes)\n${resumeLines.join("\n")}\n`
    );
  }

  // Available sessions to join (from other agents or unassigned)
  if (ctx.availableSessions.length > 0) {
    const joinLines = ctx.availableSessions.map((s) => {
      const best = s.bestComposite !== null
        ? `best composite ${s.bestComposite.toFixed(3)}`
        : "no results yet";
      return `- ${s.sessionName} (id: ${s.sessionId}) — focus: ${s.focus}, players: ${s.players.join(", ")}, ${s.experimentCount} experiments, ${best}`;
    });
    sections.push(
      `## Available Sessions to Join\nThese are paused sessions from other agents or unassigned. You can take over and continue their work.\n${joinLines.join("\n")}\n`
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

  // Papers needing review
  if (ctx.papersNeedingReview.length > 0) {
    const paperLines = ctx.papersNeedingReview.map(
      (p) => `- [${p.paperId}] "${p.title}" by ${p.authorAgentName} (delta: ${p.compositeDelta >= 0 ? "+" : ""}${p.compositeDelta.toFixed(4)}, reviews: ${p.reviewCount}/2)`
    );
    sections.push(
      `## Papers Needing Peer Review\nThese papers need reviewers. Use action "review_paper" with the paper ID.\n${paperLines.join("\n")}\n`
    );
  }

  // Own papers needing revision
  if (ctx.papersNeedingRevision.length > 0) {
    const revLines = ctx.papersNeedingRevision.map(
      (p) => `- [${p.paperId}] "${p.title}" — submission #${p.submissionCount}, reviewers have requested revision`
    );
    sections.push(
      `## Your Papers Needing Revision\nReviewers have requested changes. Use action "review_paper" with your paper ID to start a revision session.\n${revLines.join("\n")}\n`
    );
  }

  // Recent published papers (literature awareness)
  if (ctx.recentPapers.length > 0) {
    const litLines = ctx.recentPapers.map(
      (p) => `- "${p.title}" by ${p.authorAgentName} (delta: ${p.compositeDelta >= 0 ? "+" : ""}${p.compositeDelta.toFixed(4)})`
    );
    sections.push(
      `## Recent Research Papers\nRead these to inform your next session. Cite relevant work.\n${litLines.join("\n")}\n`
    );
  }

  // Decision rules — conditioned on research bias
  const biasRules: string[] = [
    `1. **PREFER REUSING SESSIONS.** Before creating a new session, check if an existing session already covers the focus area and players you want. Use "resume_session" for your own sessions or "join_session" for sessions from other agents. Only create a new session ("start_new") when no existing session matches your intended work.`,
    `2. If a paused session has promising unfinished work, prefer RESUMING or JOINING it.`,
    `3. Diversify: pick focus areas and players that haven't been explored much.`,
    `4. **PREFER LOWER-RATED PLAYERS (1200-2000 Elo).** Lower-rated players are significantly more valuable for Maia-style research: at lower Stockfish depth, move distinctions are subtler, and human move patterns are more distinctive and varied. High-rated players (2400+) play closer to engine moves, making them less interesting research subjects. Prioritize players in the 1200-1800 range when available.`,
  ];

  if (researchBias >= 0.75) {
    biasRules.push(
      `5. If behind on the leaderboard, strongly consider committing to a "groundbreaking" exploratory hypothesis — groundbreaking sessions earn **5x** the leaderboard score of incremental sessions. This is the fastest way to climb to #1.`,
    );
  } else if (researchBias >= 0.4) {
    biasRules.push(
      `5. Weigh your options: groundbreaking sessions earn 5x but carry risk. Continuous sessions earn 1x but compound reliably. Choose based on your leaderboard position and what the knowledge base tells you about unexplored territory.`,
    );
  } else {
    biasRules.push(
      `5. Prefer incremental improvements that build on proven approaches. Continuous sessions earn 1x each and compound reliably. Only consider groundbreaking (5x) if you have specific evidence that incremental approaches have plateaued for this focus area.`,
    );
  }

  biasRules.push(
    `6. You can combine multiple focus areas with commas (e.g., "accuracy,opening").`,
    `7. If no players are available, output action "wait".`,
    `8. Pick 1-3 players per session — don't use all players every time.`,
  );

  if (researchBias >= 0.75) {
    biasRules.push(
      `9. Your objective is to reach **#1 on the leaderboard**. The 5x multiplier for groundbreaking (exploratory) research means a single successful groundbreaking session can outweigh five incremental sessions. Factor this into your strategy.`,
      `10. **IMPORTANT: Config-only sessions (zero code changes) receive a 0.5x PENALTY.** A single successful groundbreaking session with code changes (5x) outweighs TEN config-only continuous sessions. Plan to make CODE changes via forge.code.prompt().`,
    );
  } else if (researchBias >= 0.4) {
    biasRules.push(
      `9. Your objective is to reach **#1 on the leaderboard**. Both groundbreaking (5x) and continuous (1x) strategies can succeed. Five solid continuous sessions equal one successful groundbreaking session. Choose based on what you know.`,
      `10. **IMPORTANT: Config-only sessions receive a 0.5x PENALTY.** Always plan to make at least one code change via forge.code.prompt().`,
    );
  } else {
    biasRules.push(
      `9. Your objective is to reach **#1 on the leaderboard** through consistent, validated improvements. Five successful continuous sessions (1x each) equal one successful groundbreaking session (5x). Reliability is your edge.`,
      `10. **IMPORTANT: Config-only sessions receive a 0.5x PENALTY.** Always plan to make at least one code change via forge.code.prompt(). Focus on code changes that are scoped enough to validate in a single session.`,
    );
  }

  // Paper-related rules
  biasRules.push(
    `11. **PEER REVIEW**: If papers need review and you are NOT the author, consider reviewing one. Scientific peer review builds credibility and helps you learn from others' research.`,
    `12. **REVISION PRIORITY**: If YOUR paper has revision requests (submissionCount < 3), prioritize responding to reviewer feedback. A revision session lets you run additional experiments to address concerns.`,
    `13. **LITERATURE REVIEW**: Before starting new research, read the existing papers listed above. Cite relevant prior work in your session via forge.papers.cite(id).`,
  );

  sections.push(`## Decision Rules\n${biasRules.join("\n")}\n\nRespond with ONLY valid JSON (no markdown, no explanation):\n{\n  "action": "start_new" | "resume_session" | "join_session" | "review_paper" | "wait",\n  "players": ["username1", "username2"],\n  "focus": "accuracy",\n  "resumeSessionId": "session-id-here (for resume_session)",\n  "joinSessionId": "session-id-here (for join_session)",\n  "reviewPaperId": "paper-id-here (for review_paper)",\n  "reasoning": "Brief explanation of why this choice"\n}`);

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

  if (action === "review_paper") {
    const paperId = String(raw.reviewPaperId ?? "");
    if (paperId) {
      return {
        action: "review_paper",
        players,
        focus,
        reviewPaperId: paperId,
        reasoning,
      };
    }
    // Fallback to start_new if no valid paper ID
    console.log(`  ⚠ review_paper without valid paperId, falling back to start_new`);
  }

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

  if (action === "join_session") {
    const joinId = String(raw.joinSessionId ?? "");
    const joinable = ctx.availableSessions.find(
      (s) => s.sessionId === joinId
    );
    if (joinable) {
      return {
        action: "join_session",
        players: joinable.players,
        focus: joinable.focus,
        joinSessionId: joinId,
        reasoning,
      };
    }
    // Fallback to start_new if session not joinable
    console.log(
      `  ⚠ Session ${joinId} not joinable, falling back to start_new`
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
  agentName: string,
  researchBias: number = 0.5
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

  const prompt = buildDecisionPrompt(ctx, researchBias);

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

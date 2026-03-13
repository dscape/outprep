import fs from "fs";
import path from "path";
import type {
  ForgeState,
  ForgeSession,
  SessionSummary,
  KnowledgeTopic,
  AgentSummary,
  AgentDetail,
  LeaderboardEntry,
  FeatureRequest,
} from "@/lib/forge-types";

/* ── Rich agent status ────────────────────────────────────── */

export type AgentRunStatus =
  | { status: "running"; pid: number; sessionId?: string }
  | { status: "stopped"; lastSession?: string }
  | { status: "waiting_for_tool"; tool: string; jobId: string }
  | { status: "blocked_on_permission"; requestId: string; permissionType: string }
  | { status: "dead"; reason: string };

const FORGE_ROOT = process.env.FORGE_DATA_DIR || process.cwd();
const DB_PATH = path.join(FORGE_ROOT, "forge.db");
const PIDS_DIR = path.join(FORGE_ROOT, ".pids");
// Legacy paths (kept for reference; data now in SQLite)
const LOGS_DIR = path.join(FORGE_ROOT, "logs");

const EMPTY_STATE: ForgeState = {
  version: 2,
  sessions: [],
  agents: [],
  activeSessionId: null,
  lastCheckpoint: new Date().toISOString(),
};

/* ── SQLite helpers ──────────────────────────────────────── */

/** Open the forge.db in readonly mode for UI reads. */
function openDb(): any | null {
  try {
    if (!fs.existsSync(DB_PATH)) return null;
    const Database = require("better-sqlite3");
    return new Database(DB_PATH, { readonly: true });
  } catch {
    return null;
  }
}

/** Safely parse a JSON column that may be null/undefined. */
function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/* ── State ──────────────────────────────────────────────── */

export function isForgeAvailable(): boolean {
  return true;
}

export function loadForgeState(): ForgeState {
  const db = openDb();
  if (!db) return { ...EMPTY_STATE };

  try {
    // Sessions
    const sessionRows = db.prepare("SELECT * FROM sessions ORDER BY created_at").all() as any[];
    const sessions: ForgeSession[] = sessionRows.map(rowToSession);

    // Load nested data for each session
    for (const session of sessions) {
      loadSessionNested(db, session);
    }

    // Agents
    const agentRows = db.prepare("SELECT * FROM agents ORDER BY created_at").all() as any[];
    const agents = agentRows.map(rowToAgent);

    for (const agent of agents) {
      agent.sessionHistory = (
        db.prepare("SELECT * FROM agent_session_history WHERE agent_id = ? ORDER BY started_at").all(agent.id) as any[]
      ).map(rowToSessionEntry);
    }

    // Meta
    const activeSessionId = getMetaValue(db, "activeSessionId");
    const lastCheckpoint = getMetaValue(db, "lastCheckpoint") ?? new Date().toISOString();

    db.close();

    return {
      version: 2,
      sessions,
      agents,
      activeSessionId,
      lastCheckpoint,
    };
  } catch (err) {
    try { db.close(); } catch {}
    console.error(`[forge] Failed to load from SQLite: ${err}`);
    return { ...EMPTY_STATE };
  }
}

function getMetaValue(db: any, key: string): string | null {
  try {
    const row = db.prepare("SELECT value FROM forge_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/* ── Row mappers ─────────────────────────────────────────── */

function rowToSession(row: any): ForgeSession {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    agentId: row.agent_id ?? null,
    worktreeBranch: row.worktree_branch ?? "",
    focus: row.focus ?? "",
    players: parseJson<string[]>(row.players, []),
    baseline: parseJson(row.baseline, null),
    bestResult: parseJson(row.best_result, null),
    bestExperimentId: row.best_experiment_id ?? null,
    totalInputTokens: row.total_input_tokens ?? 0,
    totalOutputTokens: row.total_output_tokens ?? 0,
    totalCostUsd: row.total_cost_usd ?? 0,
    conversationHistory: parseJson(row.conversation_history, []),
    experiments: [],
    activeChanges: [],
    oracleConsultations: [],
    interactions: [],
    hypothesisSets: [],
    oracleSurprises: [],
    killSignals: [],
    reflections: [],
  };
}

function rowToAgent(row: any): any {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status ?? "stopped",
    currentSessionId: row.current_session_id ?? null,
    config: parseJson(row.config, { maxExperiments: 10, seed: 42, quick: false }),
    totalInputTokens: row.total_input_tokens ?? 0,
    totalOutputTokens: row.total_output_tokens ?? 0,
    totalCostUsd: row.total_cost_usd ?? 0,
    sessionHistory: [],
  };
}

function rowToSessionEntry(row: any): any {
  return {
    sessionId: row.session_id,
    sessionName: row.session_name ?? "",
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    ...(row.end_reason != null ? { endReason: row.end_reason } : {}),
    ...(row.decision != null ? { decision: parseJson(row.decision, undefined) } : {}),
  };
}

function loadSessionNested(db: any, session: ForgeSession): void {
  const sid = session.id;

  session.experiments = (
    db.prepare("SELECT * FROM experiments WHERE session_id = ? ORDER BY number").all(sid) as any[]
  ).map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    number: row.number,
    timestamp: row.timestamp,
    hypothesis: row.hypothesis ?? "",
    category: row.category ?? "parameter",
    codeChanges: parseJson(row.code_changes, []),
    configChanges: parseJson(row.config_changes, []),
    players: parseJson(row.players, []),
    positionsEvaluated: row.positions_evaluated ?? 0,
    evaluationDurationMs: row.evaluation_duration_ms ?? 0,
    result: parseJson(row.result, {} as any),
    delta: parseJson(row.delta, {} as any),
    significance: parseJson(row.significance, []),
    conclusion: row.conclusion ?? "inconclusive",
    notes: row.notes ?? "",
    nextSteps: parseJson(row.next_steps, []),
    ...(row.oracle_query_id != null ? { oracleQueryId: row.oracle_query_id } : {}),
    ...(row.archetype != null ? { archetype: row.archetype } : {}),
    ...(row.hypothesis_set_id != null ? { hypothesisSetId: row.hypothesis_set_id } : {}),
    ...(row.hypothesis_level != null ? { hypothesisLevel: row.hypothesis_level } : {}),
  }));

  session.oracleConsultations = (
    db.prepare("SELECT * FROM oracle_consultations WHERE session_id = ? ORDER BY timestamp").all(sid) as any[]
  ).map((row: any) => ({
    id: row.id,
    timestamp: row.timestamp,
    question: row.question ?? "",
    domain: row.domain ?? "",
    claudeInitial: row.claude_initial ?? "",
    chatgptResponse: row.chatgpt_response ?? "",
    claudeFinal: row.claude_final ?? "",
    actionItems: parseJson(row.action_items, []),
    confidence: row.confidence ?? "medium",
    ...(row.query_type != null ? { queryType: row.query_type } : {}),
  }));

  session.interactions = (
    db.prepare("SELECT * FROM interactions WHERE session_id = ? ORDER BY timestamp").all(sid) as any[]
  ).map((row: any) => ({
    id: row.id,
    timestamp: row.timestamp,
    provider: row.provider ?? "claude",
    model: row.model ?? "",
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    costUsd: row.cost_usd ?? 0,
    purpose: row.purpose ?? "agent-turn",
    label: row.label ?? "",
    sentSummary: row.sent_summary ?? "",
    receivedSummary: row.received_summary ?? "",
  }));

  session.hypothesisSets = (
    db.prepare("SELECT * FROM hypothesis_sets WHERE session_id = ? ORDER BY timestamp").all(sid) as any[]
  ).map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    hypotheses: parseJson(row.hypotheses, [] as any),
    committedLevel: row.committed_level ?? "continuous-a",
    commitmentRationale: row.commitment_rationale ?? "",
    costOfBeingWrong: row.cost_of_being_wrong ?? "",
  }));

  session.oracleSurprises = (
    db.prepare("SELECT * FROM oracle_surprises WHERE session_id = ? ORDER BY timestamp").all(sid) as any[]
  ).map((row: any) => ({
    oracleId: row.oracle_id,
    timestamp: row.timestamp,
    priorExpectation: row.prior_expectation ?? "",
    wasSurprising: Boolean(row.was_surprising),
    ...(row.surprise_explanation != null ? { surpriseExplanation: row.surprise_explanation } : {}),
  }));

  session.killSignals = (
    db.prepare("SELECT * FROM kill_signals WHERE session_id = ? ORDER BY timestamp").all(sid) as any[]
  ).map((row: any) => ({
    id: row.id,
    timestamp: row.timestamp,
    hypothesisSetId: row.hypothesis_set_id ?? "",
    description: row.description ?? "",
    abandonmentPoint: row.abandonment_point ?? "",
    reason: row.reason ?? "",
    firstOracleType: row.first_oracle_type ?? "none",
    surpriseRateAtAbandonment: row.surprise_rate_at_abandonment ?? 0,
    experimentsCompleted: row.experiments_completed ?? 0,
  }));

  session.reflections = (
    db.prepare("SELECT * FROM reflections WHERE session_id = ? ORDER BY timestamp").all(sid) as any[]
  ).map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    afterExperimentNumber: row.after_experiment_number ?? 0,
    ruledOut: row.ruled_out ?? "",
    surpriseRateAnalysis: row.surprise_rate_analysis ?? "",
    unexpectedResultDescription: row.unexpected_result_description ?? "",
    currentSurpriseRate: row.current_surprise_rate ?? 0,
  }));

  session.activeChanges = (
    db.prepare("SELECT * FROM active_changes WHERE session_id = ? ORDER BY timestamp").all(sid) as any[]
  ).map((row: any) => ({
    id: row.id,
    timestamp: row.timestamp ?? "",
    file: row.file ?? "",
    description: row.description ?? "",
    hypothesis: row.hypothesis ?? "",
    diff: row.diff ?? "",
    type: row.type ?? "code",
  }));
}

/**
 * Check if a forge agent process is actually running via agent PID file.
 */
function isAgentProcessRunning(agentId: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(PIDS_DIR, `agent-${agentId}.pid`), "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (!Number.isFinite(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a session is running by checking its agent's PID.
 */
function isSessionRunning(session: { id: string; agentId?: string | null }): boolean {
  if (!session.agentId) return false;
  if (!isAgentProcessRunning(session.agentId)) return false;
  // Also check that this is the agent's *current* session, not an old one
  const db = openDb();
  if (!db) return false;
  try {
    const row = db.prepare("SELECT current_session_id FROM agents WHERE id = ?").get(session.agentId) as any;
    db.close();
    return row?.current_session_id === session.id;
  } catch {
    try { db.close(); } catch {}
    return false;
  }
}

/**
 * Get rich agent status including waiting/blocked/dead states.
 */
export function getAgentRunStatus(agentId: string): AgentRunStatus {
  // 1. Check PID file
  try {
    const raw = fs.readFileSync(path.join(PIDS_DIR, `agent-${agentId}.pid`), "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (Number.isFinite(pid)) {
      try {
        process.kill(pid, 0); // Check if alive
        // Process is running - check for tool jobs and permissions
        const db = openDb();
        if (db) {
          try {
            // Check blocking tool jobs
            const toolJob = db.prepare(
              `SELECT id, tool_name FROM tool_jobs WHERE agent_id = ? AND blocking = 1 AND status NOT IN ('completed', 'failed') LIMIT 1`
            ).get(agentId) as any;
            if (toolJob) {
              db.close();
              return { status: "waiting_for_tool", tool: toolJob.tool_name, jobId: toolJob.id };
            }

            // Check pending permissions
            const perm = db.prepare(
              `SELECT id, permission_type FROM permission_requests WHERE agent_id = ? AND status = 'pending' LIMIT 1`
            ).get(agentId) as any;
            if (perm) {
              db.close();
              return { status: "blocked_on_permission", requestId: perm.id, permissionType: perm.permission_type ?? "unknown" };
            }

            // Get current session
            const agent = db.prepare(`SELECT current_session_id FROM agents WHERE id = ?`).get(agentId) as any;
            db.close();
            return { status: "running", pid, sessionId: agent?.current_session_id };
          } catch {
            try { db.close(); } catch {}
            return { status: "running", pid };
          }
        }
        return { status: "running", pid };
      } catch {
        // PID file exists but process is dead
        return { status: "dead", reason: `PID ${pid} is not running` };
      }
    }
  } catch {
    // No PID file
  }

  return { status: "stopped" };
}

export function getSessionSummaries(): SessionSummary[] {
  const state = loadForgeState();
  if (!state) return [];

  return state.sessions.map((s) => {
    const running = isSessionRunning(s);
    // If state says "active" but no process is alive, it's actually paused
    const status = s.status === "active" && !running ? "paused" : s.status;
    // Find agent name if session has an agentId
    const agent = s.agentId
      ? state.agents?.find((a: any) => a.id === s.agentId)
      : null;
    return {
      id: s.id,
      name: s.name,
      status,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      focus: s.focus,
      players: s.players,
      experimentCount: s.experiments.length,
      oracleCount: s.oracleConsultations.length,
      totalCostUsd: s.totalCostUsd,
      totalInputTokens: s.totalInputTokens,
      totalOutputTokens: s.totalOutputTokens,
      bestCompositeScore: s.bestResult?.compositeScore ?? null,
      worktreeBranch: s.worktreeBranch,
      agentId: s.agentId ?? null,
      agentName: agent?.name ?? null,
      isRunning: running,
    };
  });
}

export function getSession(id: string): (Omit<ForgeSession, "conversationHistory"> & { isRunning: boolean }) | null {
  const db = openDb();
  if (!db) return null;

  try {
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
    if (!row) { db.close(); return null; }

    const session = rowToSession(row);
    loadSessionNested(db, session);
    db.close();

    const running = isSessionRunning(session);
    const status = session.status === "active" && !running ? "paused" : session.status;

    // Strip conversationHistory (large, only needed for agent resume)
    const { conversationHistory: _, ...rest } = session;
    return { ...rest, status, isRunning: running };
  } catch (err) {
    try { db.close(); } catch {}
    console.error(`[forge] Failed to load session ${id}: ${err}`);
    return null;
  }
}

/**
 * If a session is still marked "active" in state but its process has exited,
 * patch it to "paused" so the UI shows the correct controls.
 */
export function markSessionPausedIfActive(nameOrId: string): void {
  try {
    if (!fs.existsSync(DB_PATH)) return;
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH);
    const row = db.prepare(
      "SELECT id, status FROM sessions WHERE (id = ? OR name = ?) AND status = 'active'"
    ).get(nameOrId, nameOrId) as any;
    if (row) {
      db.prepare("UPDATE sessions SET status = 'paused', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), row.id);
    }
    db.close();
  } catch {
    // Ignore — best effort
  }
}

/* ── Experiment Logs (from SQLite) ──────────────────────── */

export function getSessionLogs(
  sessionId: string
): { filename: string; content: string }[] {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare(
      "SELECT id, timestamp, message FROM research_logs WHERE session_id = ? ORDER BY id"
    ).all(sessionId) as { id: number; timestamp: string; message: string }[];
    db.close();

    return rows.map((r, i) => ({
      filename: `log-${String(i + 1).padStart(3, "0")}.md`,
      content: r.message,
    }));
  } catch {
    return [];
  }
}

/* ── Console Logs ──────────────────────────────────────── */

/**
 * Get console log entries for a session from SQLite.
 * Returns the session ID if logs exist (for the streaming API to use),
 * or null if no logs.
 */
export function getConsoleLogSessionId(sessionId: string): string | null {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare("SELECT COUNT(*) as cnt FROM console_logs WHERE session_id = ?").get(sessionId) as { cnt: number };
    db.close();
    return row.cnt > 0 ? sessionId : null;
  } catch {
    return null;
  }
}

/** @deprecated — use getConsoleLogSessionId instead. Kept for backward compat. */
export function getConsoleLogPath(sessionName: string): string | null {
  const p = path.join(LOGS_DIR, sessionName, "console.jsonl");
  return fs.existsSync(p) ? p : null;
}

/* ── Knowledge (from SQLite) ────────────────────────────── */

export function loadKnowledgeTopics(): KnowledgeTopic[] {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare("SELECT id, title, relevance, updated, content FROM knowledge_topics ORDER BY id").all() as {
      id: string; title: string; relevance: string; updated: string; content: string;
    }[];
    db.close();

    return rows.map(r => ({
      id: r.id,
      topic: r.title,
      relevance: safeParseJsonArray(r.relevance),
      updated: r.updated,
      content: r.content,
    }));
  } catch {
    return [];
  }
}

export function loadAgentNotes(): KnowledgeTopic[] {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare("SELECT id, session_name, date, tags, content FROM knowledge_notes ORDER BY id DESC").all() as {
      id: number; session_name: string; date: string; tags: string; content: string;
    }[];
    db.close();

    return rows.map(r => ({
      id: String(r.id),
      topic: r.session_name || `Note #${r.id}`,
      relevance: safeParseJsonArray(r.tags),
      updated: r.date,
      content: r.content,
    }));
  } catch {
    return [];
  }
}

function safeParseJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ── Game Data ─────────────────────────────────────────── */

export interface PlayerMeta {
  username: string;
  estimatedElo: number;
  gameCount: number;
  contentHash: string;
  fetchedAt: string;
}

export function listGamePlayers(): PlayerMeta[] {
  const db = openDb();
  if (!db) return [];

  try {
    const rows = db.prepare("SELECT * FROM player_meta ORDER BY username").all() as any[];
    db.close();
    return rows.map((r: any) => ({
      username: r.username,
      estimatedElo: r.estimated_elo ?? 0,
      gameCount: r.game_count ?? 0,
      contentHash: r.content_hash ?? "",
      fetchedAt: r.fetched_at ?? "",
    }));
  } catch {
    try { db.close(); } catch {}
    return [];
  }
}

export function getPlayerGames(
  username: string,
  page = 1,
  limit = 50
): { games: unknown[]; total: number } {
  const db = openDb();
  if (!db) return { games: [], total: 0 };

  try {
    const countRow = db.prepare("SELECT COUNT(*) as cnt FROM player_games WHERE username = ?").get(username.toLowerCase()) as any;
    const total = countRow?.cnt ?? 0;
    const offset = (page - 1) * limit;
    const rows = db.prepare("SELECT game_data FROM player_games WHERE username = ? LIMIT ? OFFSET ?")
      .all(username.toLowerCase(), limit, offset) as any[];
    db.close();
    return {
      games: rows.map((r: any) => parseJson(r.game_data, {})),
      total,
    };
  } catch {
    try { db.close(); } catch {}
    return { games: [], total: 0 };
  }
}

/* ── Agents ────────────────────────────────────────────── */

export function getAgentSummaries(): AgentSummary[] {
  const state = loadForgeState();
  if (!state) return [];

  // Try to load leaderboard data
  let leaderboard: LeaderboardEntry[] = [];
  try {
    const dbPath = path.join(FORGE_ROOT, "leaderboard.db");
    if (fs.existsSync(dbPath)) {
      const Database = require("better-sqlite3");
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare(`
        SELECT agent_id, agent_name, COUNT(*) as sessions_count,
          AVG(accuracy_delta) as avg_accuracy_delta,
          AVG(cpl_kl_delta) as avg_cpl_kl_delta,
          AVG(weighted_composite_delta) as avg_weighted_composite_delta,
          SUM(duration_seconds) as total_time_seconds,
          SUM(total_cost_usd) as total_cost_usd
        FROM agent_session_results WHERE ended_at IS NOT NULL
        GROUP BY agent_id ORDER BY avg_weighted_composite_delta DESC
      `).all() as any[];
      leaderboard = rows.map((r: any, i: number) => ({
        agentId: r.agent_id,
        agentName: r.agent_name,
        rank: i + 1,
        sessionsCount: r.sessions_count,
        avgAccuracyDelta: r.avg_accuracy_delta,
        avgCplKlDelta: r.avg_cpl_kl_delta,
        avgWeightedCompositeDelta: r.avg_weighted_composite_delta,
        totalTimeSeconds: r.total_time_seconds,
        totalCostUsd: r.total_cost_usd,
      }));
      db.close();
    }
  } catch {
    // SQLite not available
  }

  const rankMap = new Map(leaderboard.map((e) => [e.agentId, e]));

  return (state.agents ?? []).map((a: any) => {
    const richStatus = getAgentRunStatus(a.id);
    const running = richStatus.status === "running" || richStatus.status === "waiting_for_tool" || richStatus.status === "blocked_on_permission";
    const status = a.status === "running" && !running ? "stopped" : a.status;
    const currentSession = a.currentSessionId
      ? state.sessions.find((s) => s.id === a.currentSessionId)
      : null;
    const entry = rankMap.get(a.id);

    // Derive display status and detail
    let runStatus: "running" | "stopped" | "waiting_for_tool" | "blocked_on_permission" | "dead" = richStatus.status;
    let runStatusDetail: string | undefined;
    if (richStatus.status === "waiting_for_tool") {
      runStatusDetail = richStatus.tool;
    } else if (richStatus.status === "blocked_on_permission") {
      runStatusDetail = richStatus.permissionType;
    }

    return {
      id: a.id,
      name: a.name,
      status,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      currentSessionId: a.currentSessionId,
      currentSessionName: currentSession?.name ?? null,
      sessionCount: a.sessionHistory.length,
      totalCostUsd: a.totalCostUsd,
      config: a.config,
      isRunning: running,
      runStatus,
      runStatusDetail,
      rank: entry?.rank ?? null,
      avgWeightedCompositeDelta: entry?.avgWeightedCompositeDelta ?? 0,
      avgAccuracyDelta: entry?.avgAccuracyDelta ?? 0,
      totalTimeSeconds: entry?.totalTimeSeconds ?? 0,
    };
  });
}

export function getAgent(agentId: string): AgentDetail | null {
  const state = loadForgeState();
  if (!state) return null;

  const agent = (state.agents ?? []).find((a: any) => a.id === agentId);
  if (!agent) return null;

  const richStatus = getAgentRunStatus(agent.id);
  const running = richStatus.status === "running" || richStatus.status === "waiting_for_tool" || richStatus.status === "blocked_on_permission";
  const status = agent.status === "running" && !running ? "stopped" : agent.status;
  const currentSession = agent.currentSessionId
    ? state.sessions.find((s) => s.id === agent.currentSessionId)
    : null;

  // Derive display status and detail
  let runStatus: "running" | "stopped" | "waiting_for_tool" | "blocked_on_permission" | "dead" = richStatus.status;
  let runStatusDetail: string | undefined;
  if (richStatus.status === "waiting_for_tool") {
    runStatusDetail = richStatus.tool;
  } else if (richStatus.status === "blocked_on_permission") {
    runStatusDetail = richStatus.permissionType;
  }

  // Load leaderboard rank for this agent
  let rank: number | null = null;
  let avgWeightedCompositeDelta = 0;
  let avgAccuracyDelta = 0;
  let totalTimeSeconds = 0;
  try {
    const dbPath = path.join(FORGE_ROOT, "leaderboard.db");
    if (fs.existsSync(dbPath)) {
      const Database = require("better-sqlite3");
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare(`
        SELECT agent_id,
          AVG(accuracy_delta) as avg_accuracy_delta,
          AVG(weighted_composite_delta) as avg_weighted_composite_delta,
          SUM(duration_seconds) as total_time_seconds
        FROM agent_session_results WHERE ended_at IS NOT NULL
        GROUP BY agent_id ORDER BY avg_weighted_composite_delta DESC
      `).all() as any[];
      db.close();
      const idx = rows.findIndex((r: any) => r.agent_id === agentId);
      if (idx !== -1) {
        rank = idx + 1;
        avgWeightedCompositeDelta = rows[idx].avg_weighted_composite_delta;
        avgAccuracyDelta = rows[idx].avg_accuracy_delta;
        totalTimeSeconds = rows[idx].total_time_seconds;
      }
    }
  } catch {
    // SQLite not available
  }

  return {
    id: agent.id,
    name: agent.name,
    status,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    currentSessionId: agent.currentSessionId,
    currentSessionName: currentSession?.name ?? null,
    sessionCount: agent.sessionHistory.length,
    totalCostUsd: agent.totalCostUsd,
    config: agent.config,
    isRunning: running,
    runStatus,
    runStatusDetail,
    rank,
    avgWeightedCompositeDelta,
    avgAccuracyDelta,
    totalTimeSeconds,
    sessionHistory: agent.sessionHistory,
    totalInputTokens: agent.totalInputTokens,
    totalOutputTokens: agent.totalOutputTokens,
  };
}

export function getAgentBasicInfo(agentId: string): { id: string; name: string; isRunning: boolean } | null {
  const db = openDb();
  if (!db) return null;

  try {
    const row = db.prepare("SELECT id, name FROM agents WHERE id = ?").get(agentId) as any;
    db.close();
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      isRunning: isAgentProcessRunning(row.id),
    };
  } catch {
    try { db.close(); } catch {}
    return null;
  }
}

export function getLeaderboard(): LeaderboardEntry[] {
  try {
    const dbPath = path.join(FORGE_ROOT, "leaderboard.db");
    if (!fs.existsSync(dbPath)) return [];
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare(`
      SELECT agent_id, agent_name, COUNT(*) as sessions_count,
        AVG(accuracy_delta) as avg_accuracy_delta,
        AVG(cpl_kl_delta) as avg_cpl_kl_delta,
        AVG(weighted_composite_delta) as avg_weighted_composite_delta,
        SUM(duration_seconds) as total_time_seconds,
        SUM(total_cost_usd) as total_cost_usd
      FROM agent_session_results WHERE ended_at IS NOT NULL
      GROUP BY agent_id ORDER BY avg_weighted_composite_delta DESC
    `).all() as any[];
    db.close();
    return rows.map((r: any, i: number) => ({
      agentId: r.agent_id,
      agentName: r.agent_name,
      rank: i + 1,
      sessionsCount: r.sessions_count,
      avgAccuracyDelta: r.avg_accuracy_delta,
      avgCplKlDelta: r.avg_cpl_kl_delta,
      avgWeightedCompositeDelta: r.avg_weighted_composite_delta,
      totalTimeSeconds: r.total_time_seconds,
      totalCostUsd: r.total_cost_usd,
    }));
  } catch {
    return [];
  }
}

export function getFeatureRequests(opts?: {
  status?: string;
  agentId?: string;
}): FeatureRequest[] {
  try {
    const dbPath = path.join(FORGE_ROOT, "leaderboard.db");
    if (!fs.existsSync(dbPath)) return [];
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });

    let sql = "SELECT * FROM feature_requests";
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts?.status) { conditions.push("status = ?"); params.push(opts.status); }
    if (opts?.agentId) { conditions.push("agent_id = ?"); params.push(opts.agentId); }
    if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY timestamp DESC";

    const rows = db.prepare(sql).all(...params) as any[];
    db.close();

    return rows.map((r: any) => ({
      id: r.id,
      agentId: r.agent_id,
      agentName: r.agent_name,
      sessionId: r.session_id,
      timestamp: r.timestamp,
      title: r.title,
      description: r.description,
      category: r.category,
      status: r.status,
      response: r.response,
    }));
  } catch {
    return [];
  }
}

export function updateFeatureRequestStatus(
  id: string,
  status: string,
  response?: string,
): boolean {
  try {
    const dbPath = path.join(FORGE_ROOT, "leaderboard.db");
    if (!fs.existsSync(dbPath)) return false;
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    db.prepare("UPDATE feature_requests SET status = ?, response = ? WHERE id = ?")
      .run(status, response ?? null, id);
    db.close();
    return true;
  } catch {
    return false;
  }
}

/* ── Activity Log ──────────────────────────────────────── */

export function buildActivityLog(
  session: Omit<ForgeSession, "conversationHistory">
): import("./forge-types").ActivityEvent[] {
  const events: import("./forge-types").ActivityEvent[] = [];

  for (const exp of session.experiments) {
    events.push({
      id: `exp-${exp.id}`,
      timestamp: exp.timestamp,
      type: "experiment",
      title: `Experiment #${exp.number}: ${exp.hypothesis.slice(0, 80)}`,
      detail: `${exp.conclusion} — composite delta ${exp.delta.compositeScore > 0 ? "+" : ""}${exp.delta.compositeScore.toFixed(3)}`,
      artifactId: exp.id,
      artifactType: "experiments",
      consoleTimestamp: exp.timestamp,
    });

    for (const cc of exp.codeChanges) {
      events.push({
        id: `cc-${cc.id}`,
        timestamp: cc.timestamp,
        type: "code-change",
        title: `Code change: ${cc.file}`,
        detail: cc.description,
        artifactId: cc.id,
        artifactType: "changes",
        consoleTimestamp: cc.timestamp,
      });
    }
  }

  for (const o of session.oracleConsultations) {
    events.push({
      id: `oracle-${o.id}`,
      timestamp: o.timestamp,
      type: "oracle",
      title: `Oracle: ${o.question.slice(0, 80)}`,
      detail: `Confidence: ${o.confidence}`,
      artifactId: o.id,
      artifactType: "oracle",
      consoleTimestamp: o.timestamp,
    });
  }

  for (const cc of session.activeChanges) {
    if (!events.some((e) => e.id === `cc-${cc.id}`)) {
      events.push({
        id: `cc-${cc.id}`,
        timestamp: cc.timestamp,
        type: "code-change",
        title: `Active change: ${cc.file}`,
        detail: cc.description,
        artifactId: cc.id,
        artifactType: "changes",
        consoleTimestamp: cc.timestamp,
      });
    }
  }

  // Hypothesis set events
  for (const hs of session.hypothesisSets ?? []) {
    const committed = hs.hypotheses.find((h: any) => h.level === hs.committedLevel);
    events.push({
      id: `hypothesis-${hs.id}`,
      timestamp: hs.timestamp,
      type: "hypothesis",
      title: `Hypothesis: committed to ${hs.committedLevel}`,
      detail: committed?.statement?.slice(0, 80),
      artifactId: hs.id,
      artifactType: "hypotheses",
    });
  }

  // Kill signal events
  for (const ks of session.killSignals ?? []) {
    events.push({
      id: `kill-${ks.id}`,
      timestamp: ks.timestamp,
      type: "kill-signal",
      title: `Killed: ${ks.description.slice(0, 80)}`,
      detail: ks.reason.slice(0, 80),
      artifactId: ks.id,
      artifactType: "hypotheses",
    });
  }

  // Reflection events
  for (const ref of session.reflections ?? []) {
    events.push({
      id: `reflection-${ref.id}`,
      timestamp: ref.timestamp,
      type: "reflection",
      title: `Reflection after experiment #${ref.afterExperimentNumber}`,
      detail: `Surprise rate: ${(ref.currentSurpriseRate * 100).toFixed(0)}%`,
      artifactId: ref.id,
      artifactType: "hypotheses",
    });
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return events;
}

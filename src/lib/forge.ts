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
} from "./forge-types";

const FORGE_ROOT = process.env.FORGE_DATA_DIR || path.join(process.cwd(), "packages", "forge");
const STATE_PATH = path.join(FORGE_ROOT, "forge-state.json");
const PIDS_DIR = path.join(FORGE_ROOT, ".pids");
const TOPICS_DIR = path.join(FORGE_ROOT, "src", "knowledge", "topics");
const NOTES_DIR = path.join(FORGE_ROOT, "src", "knowledge", "notes");
const LOGS_DIR = path.join(FORGE_ROOT, "logs");
const GAMES_DIR = path.join(FORGE_ROOT, "data", "games");

const EMPTY_STATE: ForgeState = {
  version: 2,
  sessions: [],
  agents: [],
  activeSessionId: null,
  lastCheckpoint: new Date().toISOString(),
};

/* ── State ──────────────────────────────────────────────── */

export function isForgeAvailable(): boolean {
  return true;
}

export function loadForgeState(): ForgeState {
  if (!fs.existsSync(STATE_PATH)) {
    const empty = { ...EMPTY_STATE };
    // Auto-create the state file so the app has parity with the CLI
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }

  try {
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    const state = JSON.parse(raw) as ForgeState;
    // Migrate v1 → v2: add agents array
    if (!state.agents) (state as any).agents = [];
    if ((state.version as number) === 1) {
      for (const s of state.sessions) {
        if ((s as any).agentId === undefined) (s as any).agentId = null;
      }
      (state as any).version = 2;
    }
    return state;
  } catch (err) {
    console.error(`[forge] Failed to load forge-state.json: ${err}`);
    return { ...EMPTY_STATE };
  }
}

/**
 * Check if a forge agent process is actually running via PID file.
 */
function isAgentRunning(sessionId: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(PIDS_DIR, `${sessionId}.pid`), "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (!Number.isFinite(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getSessionSummaries(): SessionSummary[] {
  const state = loadForgeState();
  if (!state) return [];

  return state.sessions.map((s) => {
    const running = isAgentRunning(s.id);
    // If state says "active" but no process is alive, it's actually paused
    const status = s.status === "active" && !running ? "paused" : s.status;
    // Find agent name if session has an agentId
    const agent = s.agentId
      ? state.agents?.find((a) => a.id === s.agentId)
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
  const state = loadForgeState();
  if (!state) return null;

  const session = state.sessions.find((s) => s.id === id);
  if (!session) return null;

  const running = isAgentRunning(session.id);
  const status = session.status === "active" && !running ? "paused" : session.status;

  // Strip conversationHistory (large, only needed for agent resume)
  const { conversationHistory: _, ...rest } = session;
  return { ...rest, status, isRunning: running };
}

/**
 * If a session is still marked "active" in state but its process has exited,
 * patch it to "paused" so the UI shows the correct controls.
 */
export function markSessionPausedIfActive(nameOrId: string): void {
  const state = loadForgeState();
  if (!state) return;
  const session = state.sessions.find(
    (s) => (s.id === nameOrId || s.name === nameOrId) && s.status === "active"
  );
  if (!session) return;
  session.status = "paused";
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/* ── Experiment Logs ────────────────────────────────────── */

export function getSessionLogs(
  sessionName: string
): { filename: string; content: string }[] {
  const dir = path.join(LOGS_DIR, sessionName);
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    return files.map((f) => ({
      filename: f,
      content: fs.readFileSync(path.join(dir, f), "utf-8"),
    }));
  } catch {
    return [];
  }
}

/* ── Console Logs ──────────────────────────────────────── */

export function getConsoleLogPath(sessionName: string): string | null {
  const p = path.join(LOGS_DIR, sessionName, "console.jsonl");
  return fs.existsSync(p) ? p : null;
}

/* ── Knowledge ──────────────────────────────────────────── */

function parseFrontmatter(raw: string): {
  meta: Record<string, string | string[]>;
  content: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };

  const meta: Record<string, string | string[]> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Parse simple YAML arrays: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim());
    } else {
      meta[key] = value;
    }
  }
  return { meta, content: match[2] };
}

function readMarkdownDir(dir: string): { id: string; raw: string }[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => ({
        id: f.replace(/\.md$/, ""),
        raw: fs.readFileSync(path.join(dir, f), "utf-8"),
      }));
  } catch {
    return [];
  }
}

export function loadKnowledgeTopics(): KnowledgeTopic[] {
  return readMarkdownDir(TOPICS_DIR).map(({ id, raw }) => {
    const { meta, content } = parseFrontmatter(raw);
    return {
      id,
      topic: (meta.topic as string) || id,
      relevance: Array.isArray(meta.relevance)
        ? meta.relevance
        : typeof meta.relevance === "string"
          ? [meta.relevance]
          : [],
      updated: (meta.updated as string) || "",
      content,
    };
  });
}

export function loadAgentNotes(): KnowledgeTopic[] {
  return readMarkdownDir(NOTES_DIR).map(({ id, raw }) => {
    const { meta, content } = parseFrontmatter(raw);
    return {
      id,
      topic: (meta.topic as string) || id,
      relevance: Array.isArray(meta.relevance)
        ? meta.relevance
        : typeof meta.relevance === "string"
          ? [meta.relevance]
          : [],
      updated: (meta.updated as string) || "",
      content,
    };
  });
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
  try {
    const files = fs.readdirSync(GAMES_DIR).filter((f) => f.endsWith(".meta.json"));
    return files.map((f) => {
      const raw = fs.readFileSync(path.join(GAMES_DIR, f), "utf-8");
      return JSON.parse(raw) as PlayerMeta;
    });
  } catch {
    return [];
  }
}

export function getPlayerGames(
  username: string,
  page = 1,
  limit = 50
): { games: unknown[]; total: number } {
  try {
    const raw = fs.readFileSync(path.join(GAMES_DIR, `${username.toLowerCase()}.json`), "utf-8");
    const allGames = JSON.parse(raw) as unknown[];
    const start = (page - 1) * limit;
    return {
      games: allGames.slice(start, start + limit),
      total: allGames.length,
    };
  } catch {
    return { games: [], total: 0 };
  }
}

/* ── Agents ────────────────────────────────────────────── */

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

  return (state.agents ?? []).map((a) => {
    const running = isAgentProcessRunning(a.id);
    const status = a.status === "running" && !running ? "stopped" : a.status;
    const currentSession = a.currentSessionId
      ? state.sessions.find((s) => s.id === a.currentSessionId)
      : null;
    const entry = rankMap.get(a.id);

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

  const agent = (state.agents ?? []).find((a) => a.id === agentId);
  if (!agent) return null;

  const running = isAgentProcessRunning(agent.id);
  const status = agent.status === "running" && !running ? "stopped" : agent.status;
  const currentSession = agent.currentSessionId
    ? state.sessions.find((s) => s.id === agent.currentSessionId)
    : null;

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
  const state = loadForgeState();
  if (!state) return null;

  const agent = (state.agents ?? []).find((a) => a.id === agentId);
  if (!agent) return null;

  return {
    id: agent.id,
    name: agent.name,
    isRunning: isAgentProcessRunning(agent.id),
  };
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
    const committed = hs.hypotheses.find((h) => h.level === hs.committedLevel);
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

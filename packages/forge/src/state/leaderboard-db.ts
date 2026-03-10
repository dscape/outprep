/**
 * SQLite-backed leaderboard and feature request tracking.
 *
 * Anti-cheating: Only the agent-manager writes to this database.
 * The REPL exposes read-only functions. Agents cannot alter their scores.
 */

import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { LeaderboardEntry, FeatureRequest } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "..", "leaderboard.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS agent_session_results (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      session_id TEXT NOT NULL,
      session_name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER DEFAULT 0,
      experiments_count INTEGER DEFAULT 0,
      accuracy_delta REAL DEFAULT 0,
      cpl_kl_delta REAL DEFAULT 0,
      composite_delta REAL DEFAULT 0,
      is_exploratory INTEGER DEFAULT 0,
      weighted_composite_delta REAL DEFAULT 0,
      total_cost_usd REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS feature_requests (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      response TEXT
    );
  `);
  return _db;
}

/* ── Write-only (called ONLY by agent-manager) ───────────── */

export interface AgentSessionResult {
  id: string;
  agentId: string;
  agentName: string;
  sessionId: string;
  sessionName: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  experimentsCount: number;
  accuracyDelta: number;
  cplKlDelta: number;
  compositeDelta: number;
  isExploratory: boolean;
  totalCostUsd: number;
}

export function recordSessionResult(result: AgentSessionResult): void {
  const db = getDb();
  const weightedDelta = result.isExploratory
    ? result.compositeDelta * 5
    : result.compositeDelta;

  db.prepare(`
    INSERT OR REPLACE INTO agent_session_results
      (id, agent_id, agent_name, session_id, session_name, started_at, ended_at,
       duration_seconds, experiments_count, accuracy_delta, cpl_kl_delta,
       composite_delta, is_exploratory, weighted_composite_delta, total_cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.id,
    result.agentId,
    result.agentName,
    result.sessionId,
    result.sessionName,
    result.startedAt,
    result.endedAt,
    result.durationSeconds,
    result.experimentsCount,
    result.accuracyDelta,
    result.cplKlDelta,
    result.compositeDelta,
    result.isExploratory ? 1 : 0,
    weightedDelta,
    result.totalCostUsd,
  );
}

export interface FeatureRequestInput {
  id: string;
  agentId: string;
  agentName: string;
  sessionId: string;
  title: string;
  description: string;
  category: string;
}

export function fileFeatureRequest(req: FeatureRequestInput): string {
  const db = getDb();
  db.prepare(`
    INSERT INTO feature_requests
      (id, agent_id, agent_name, session_id, timestamp, title, description, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.id,
    req.agentId,
    req.agentName,
    req.sessionId,
    new Date().toISOString(),
    req.title,
    req.description,
    req.category,
  );
  return req.id;
}

/* ── Read-only (safe for agents via REPL) ────────────────── */

export function getLeaderboard(): LeaderboardEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      agent_id,
      agent_name,
      COUNT(*) as sessions_count,
      AVG(accuracy_delta) as avg_accuracy_delta,
      AVG(cpl_kl_delta) as avg_cpl_kl_delta,
      AVG(weighted_composite_delta) as avg_weighted_composite_delta,
      SUM(duration_seconds) as total_time_seconds,
      SUM(total_cost_usd) as total_cost_usd
    FROM agent_session_results
    WHERE ended_at IS NOT NULL
    GROUP BY agent_id
    ORDER BY avg_weighted_composite_delta DESC
  `).all() as Array<{
    agent_id: string;
    agent_name: string;
    sessions_count: number;
    avg_accuracy_delta: number;
    avg_cpl_kl_delta: number;
    avg_weighted_composite_delta: number;
    total_time_seconds: number;
    total_cost_usd: number;
  }>;

  return rows.map((row, i) => ({
    agentId: row.agent_id,
    agentName: row.agent_name,
    rank: i + 1,
    sessionsCount: row.sessions_count,
    avgAccuracyDelta: row.avg_accuracy_delta,
    avgCplKlDelta: row.avg_cpl_kl_delta,
    avgWeightedCompositeDelta: row.avg_weighted_composite_delta,
    totalTimeSeconds: row.total_time_seconds,
    totalCostUsd: row.total_cost_usd,
  }));
}

export interface AgentStats {
  agentId: string;
  agentName: string;
  sessionsCount: number;
  avgAccuracyDelta: number;
  avgCplKlDelta: number;
  avgWeightedCompositeDelta: number;
  totalTimeSeconds: number;
  totalCostUsd: number;
  rank: number;
}

export function getAgentStats(agentId: string): AgentStats | null {
  const leaderboard = getLeaderboard();
  const entry = leaderboard.find((e) => e.agentId === agentId);
  if (!entry) return null;
  return {
    agentId: entry.agentId,
    agentName: entry.agentName,
    sessionsCount: entry.sessionsCount,
    avgAccuracyDelta: entry.avgAccuracyDelta,
    avgCplKlDelta: entry.avgCplKlDelta,
    avgWeightedCompositeDelta: entry.avgWeightedCompositeDelta,
    totalTimeSeconds: entry.totalTimeSeconds,
    totalCostUsd: entry.totalCostUsd,
    rank: entry.rank,
  };
}

export function getFeatureRequests(opts?: {
  status?: string;
  agentId?: string;
}): FeatureRequest[] {
  const db = getDb();
  let sql = "SELECT * FROM feature_requests";
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts?.agentId) {
    conditions.push("agent_id = ?");
    params.push(opts.agentId);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY timestamp DESC";

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    agent_id: string;
    agent_name: string;
    session_id: string;
    timestamp: string;
    title: string;
    description: string;
    category: string;
    status: string;
    response: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    title: row.title,
    description: row.description,
    category: row.category as FeatureRequest["category"],
    status: row.status as FeatureRequest["status"],
    response: row.response,
  }));
}

/* ── Admin (called from web app API routes) ──────────────── */

export function updateFeatureRequestStatus(
  id: string,
  status: string,
  response?: string
): void {
  const db = getDb();
  db.prepare(`
    UPDATE feature_requests SET status = ?, response = ? WHERE id = ?
  `).run(status, response ?? null, id);
}

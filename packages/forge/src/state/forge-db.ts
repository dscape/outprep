/**
 * Central SQLite database for all forge state.
 *
 * Replaces forge-state.json, file-based player data stores, and log files
 * with a single SQLite database at `packages/forge/forge.db`.
 *
 * Uses better-sqlite3 for synchronous access and WAL mode for concurrent reads.
 * Lazy singleton pattern — the database is created on first access.
 */

import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/* ── Paths ────────────────────────────────────────────────── */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "..", "forge.db");

/* ── Lazy singleton ───────────────────────────────────────── */

let _db: Database.Database | null = null;

export function getForgeDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");

  _db.exec(`
    -- Sessions (replaces forge-state.json sessions array)
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      agent_id TEXT,
      worktree_branch TEXT,
      focus TEXT,
      players TEXT,
      baseline TEXT,
      best_result TEXT,
      best_experiment_id TEXT,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cost_usd REAL DEFAULT 0,
      conversation_history TEXT,
      permissions TEXT
    );

    -- Agents
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'stopped',
      current_session_id TEXT,
      config TEXT,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cost_usd REAL DEFAULT 0
    );

    -- Experiments
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      hypothesis TEXT,
      category TEXT,
      code_changes TEXT,
      config_changes TEXT,
      players TEXT,
      positions_evaluated INTEGER DEFAULT 0,
      evaluation_duration_ms INTEGER DEFAULT 0,
      result TEXT,
      delta TEXT,
      significance TEXT,
      conclusion TEXT,
      notes TEXT,
      next_steps TEXT,
      oracle_query_id TEXT,
      archetype TEXT,
      hypothesis_set_id TEXT,
      hypothesis_level TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_experiments_session ON experiments(session_id);

    -- Player games
    CREATE TABLE IF NOT EXISTS player_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      game_id TEXT NOT NULL,
      game_data TEXT NOT NULL,
      has_eval INTEGER DEFAULT 0,
      UNIQUE(username, game_id)
    );
    CREATE INDEX IF NOT EXISTS idx_player_games_username ON player_games(username);

    -- Player metadata
    CREATE TABLE IF NOT EXISTS player_meta (
      username TEXT PRIMARY KEY,
      estimated_elo INTEGER,
      game_count INTEGER,
      content_hash TEXT,
      fetched_at TEXT
    );

    -- Pre-computed evaluations
    CREATE TABLE IF NOT EXISTS player_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      game_id TEXT NOT NULL,
      fen TEXT NOT NULL,
      move_number INTEGER,
      phase TEXT,
      eval_score INTEGER,
      best_move TEXT,
      depth INTEGER,
      UNIQUE(username, game_id, fen)
    );
    CREATE INDEX IF NOT EXISTS idx_player_evals_username ON player_evaluations(username);

    -- Research logs
    CREATE TABLE IF NOT EXISTS research_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      session_name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      level TEXT DEFAULT 'info',
      message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_research_logs_session ON research_logs(session_id);

    -- Console logs
    CREATE TABLE IF NOT EXISTS console_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      level TEXT DEFAULT 'info',
      message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_console_logs_session ON console_logs(session_id);

    -- Hypothesis sets
    CREATE TABLE IF NOT EXISTS hypothesis_sets (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      hypotheses TEXT NOT NULL,
      committed_level TEXT,
      commitment_rationale TEXT,
      cost_of_being_wrong TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hypothesis_sets_session ON hypothesis_sets(session_id);

    -- Oracle consultations
    CREATE TABLE IF NOT EXISTS oracle_consultations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      question TEXT,
      domain TEXT,
      claude_initial TEXT,
      chatgpt_response TEXT,
      claude_final TEXT,
      action_items TEXT,
      confidence TEXT,
      query_type TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_oracle_session ON oracle_consultations(session_id);

    -- Oracle surprises
    CREATE TABLE IF NOT EXISTS oracle_surprises (
      oracle_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      prior_expectation TEXT,
      was_surprising INTEGER DEFAULT 0,
      surprise_explanation TEXT,
      PRIMARY KEY(oracle_id, session_id)
    );

    -- Kill signals
    CREATE TABLE IF NOT EXISTS kill_signals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      hypothesis_set_id TEXT,
      description TEXT,
      abandonment_point TEXT,
      reason TEXT,
      first_oracle_type TEXT,
      surprise_rate_at_abandonment REAL DEFAULT 0,
      experiments_completed INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_kill_signals_session ON kill_signals(session_id);

    -- Reflections
    CREATE TABLE IF NOT EXISTS reflections (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      after_experiment_number INTEGER,
      ruled_out TEXT,
      surprise_rate_analysis TEXT,
      unexpected_result_description TEXT,
      current_surprise_rate REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_reflections_session ON reflections(session_id);

    -- Interactions (per-API-call tracking)
    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      purpose TEXT,
      label TEXT,
      sent_summary TEXT,
      received_summary TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_interactions_session ON interactions(session_id);

    -- Agent session history
    CREATE TABLE IF NOT EXISTS agent_session_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      session_name TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      end_reason TEXT,
      decision TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_history ON agent_session_history(agent_id);

    -- Active code changes
    CREATE TABLE IF NOT EXISTS active_changes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp TEXT,
      file TEXT,
      description TEXT,
      hypothesis TEXT,
      diff TEXT,
      type TEXT DEFAULT 'code'
    );
    CREATE INDEX IF NOT EXISTS idx_active_changes_session ON active_changes(session_id);

    -- Forge meta (key-value store for activeSessionId, lastCheckpoint, etc.)
    CREATE TABLE IF NOT EXISTS forge_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Tool jobs (for eval queue and generic tool waiting)
    CREATE TABLE IF NOT EXISTS tool_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT,
      tool_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      input TEXT,
      output TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      blocking INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_tool_jobs_agent ON tool_jobs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_tool_jobs_status ON tool_jobs(status);

    -- Knowledge topics
    CREATE TABLE IF NOT EXISTS knowledge_topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      relevance TEXT,
      updated TEXT,
      content TEXT NOT NULL
    );

    -- Knowledge notes (inter-agent)
    CREATE TABLE IF NOT EXISTS knowledge_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      session_name TEXT NOT NULL,
      date TEXT NOT NULL,
      tags TEXT,
      content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_notes_session ON knowledge_notes(session_id);

    -- Permission requests
    CREATE TABLE IF NOT EXISTS permission_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT,
      requested_at TEXT NOT NULL,
      permission_type TEXT,
      details TEXT,
      status TEXT DEFAULT 'pending',
      responded_at TEXT,
      response_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_perm_requests_session ON permission_requests(session_id);
    CREATE INDEX IF NOT EXISTS idx_perm_requests_status ON permission_requests(status);
  `);

  return _db;
}

/* ── Cleanup ──────────────────────────────────────────────── */

export function closeForgeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

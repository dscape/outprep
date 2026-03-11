/**
 * Persistent state management for forge sessions — SQLite-backed.
 *
 * Replaces the old JSON-file implementation with normalized SQLite tables.
 * Public API is unchanged: loadState, saveState, getActiveSession, updateSession, updateAgent.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getForgeDb } from "./forge-db";
import type {
  ForgeState,
  ForgeSession,
  ForgeAgent,
  ExperimentRecord,
  OracleRecord,
  InteractionRecord,
  HypothesisSet,
  OracleSurpriseEntry,
  KillSignalRecord,
  ReflectionCheckpoint,
  CodeChange,
  AgentSessionEntry,
} from "./types";

/* ── Paths (for one-time JSON migration) ─────────────────── */

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGACY_STATE_PATH = join(__dirname, "..", "..", "forge-state.json");

/* ── Helpers ─────────────────────────────────────────────── */

/** Safely parse a JSON column that may be null/undefined. */
function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Stringify a value for a JSON TEXT column. null/undefined → null. */
function toJson(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

/* ── Meta helpers ────────────────────────────────────────── */

function getMeta(key: string): string | null {
  const db = getForgeDb();
  const row = db.prepare("SELECT value FROM forge_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setMeta(key: string, value: string | null): void {
  const db = getForgeDb();
  db.prepare("INSERT OR REPLACE INTO forge_meta (key, value) VALUES (?, ?)").run(
    key,
    value,
  );
}

/* ── Row → TypeScript mappers ────────────────────────────── */

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
    // Nested arrays filled in by loadSessionNested()
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

function rowToExperiment(row: any): ExperimentRecord {
  return {
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
    ...(row.hypothesis_set_id != null
      ? { hypothesisSetId: row.hypothesis_set_id }
      : {}),
    ...(row.hypothesis_level != null
      ? { hypothesisLevel: row.hypothesis_level }
      : {}),
  };
}

function rowToOracle(row: any): OracleRecord {
  return {
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
  };
}

function rowToInteraction(row: any): InteractionRecord {
  return {
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
  };
}

function rowToHypothesisSet(row: any): HypothesisSet {
  return {
    id: row.id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    hypotheses: parseJson(row.hypotheses, [] as any),
    committedLevel: row.committed_level ?? "continuous-a",
    commitmentRationale: row.commitment_rationale ?? "",
    costOfBeingWrong: row.cost_of_being_wrong ?? "",
  };
}

function rowToOracleSurprise(row: any): OracleSurpriseEntry {
  return {
    oracleId: row.oracle_id,
    timestamp: row.timestamp,
    priorExpectation: row.prior_expectation ?? "",
    wasSurprising: Boolean(row.was_surprising),
    ...(row.surprise_explanation != null
      ? { surpriseExplanation: row.surprise_explanation }
      : {}),
  };
}

function rowToKillSignal(row: any): KillSignalRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    hypothesisSetId: row.hypothesis_set_id ?? "",
    description: row.description ?? "",
    abandonmentPoint: row.abandonment_point ?? "",
    reason: row.reason ?? "",
    firstOracleType: row.first_oracle_type ?? "none",
    surpriseRateAtAbandonment: row.surprise_rate_at_abandonment ?? 0,
    experimentsCompleted: row.experiments_completed ?? 0,
  };
}

function rowToReflection(row: any): ReflectionCheckpoint {
  return {
    id: row.id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    afterExperimentNumber: row.after_experiment_number ?? 0,
    ruledOut: row.ruled_out ?? "",
    surpriseRateAnalysis: row.surprise_rate_analysis ?? "",
    unexpectedResultDescription: row.unexpected_result_description ?? "",
    currentSurpriseRate: row.current_surprise_rate ?? 0,
  };
}

function rowToActiveChange(row: any): CodeChange {
  return {
    id: row.id,
    timestamp: row.timestamp ?? "",
    file: row.file ?? "",
    description: row.description ?? "",
    hypothesis: row.hypothesis ?? "",
    diff: row.diff ?? "",
    type: row.type ?? "code",
  };
}

function rowToAgent(row: any): ForgeAgent {
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
    sessionHistory: [], // filled in by loadAgentHistory()
  };
}

function rowToSessionEntry(row: any): AgentSessionEntry {
  return {
    sessionId: row.session_id,
    sessionName: row.session_name ?? "",
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    ...(row.end_reason != null ? { endReason: row.end_reason } : {}),
    ...(row.decision != null ? { decision: parseJson(row.decision, undefined) } : {}),
  };
}

/* ── Load nested data for a single session ───────────────── */

function loadSessionNested(session: ForgeSession): void {
  const db = getForgeDb();
  const sid = session.id;

  session.experiments = (
    db.prepare("SELECT * FROM experiments WHERE session_id = ? ORDER BY number").all(sid) as any[]
  ).map(rowToExperiment);

  session.oracleConsultations = (
    db
      .prepare(
        "SELECT * FROM oracle_consultations WHERE session_id = ? ORDER BY timestamp",
      )
      .all(sid) as any[]
  ).map(rowToOracle);

  session.interactions = (
    db
      .prepare("SELECT * FROM interactions WHERE session_id = ? ORDER BY timestamp")
      .all(sid) as any[]
  ).map(rowToInteraction);

  session.hypothesisSets = (
    db
      .prepare(
        "SELECT * FROM hypothesis_sets WHERE session_id = ? ORDER BY timestamp",
      )
      .all(sid) as any[]
  ).map(rowToHypothesisSet);

  session.oracleSurprises = (
    db
      .prepare(
        "SELECT * FROM oracle_surprises WHERE session_id = ? ORDER BY timestamp",
      )
      .all(sid) as any[]
  ).map(rowToOracleSurprise);

  session.killSignals = (
    db
      .prepare("SELECT * FROM kill_signals WHERE session_id = ? ORDER BY timestamp")
      .all(sid) as any[]
  ).map(rowToKillSignal);

  session.reflections = (
    db
      .prepare("SELECT * FROM reflections WHERE session_id = ? ORDER BY timestamp")
      .all(sid) as any[]
  ).map(rowToReflection);

  session.activeChanges = (
    db
      .prepare(
        "SELECT * FROM active_changes WHERE session_id = ? ORDER BY timestamp",
      )
      .all(sid) as any[]
  ).map(rowToActiveChange);
}

/* ── Persist a single session + all nested data ──────────── */

function persistSession(session: ForgeSession): void {
  const db = getForgeDb();

  // Upsert session row
  db.prepare(
    `INSERT OR REPLACE INTO sessions
       (id, name, created_at, updated_at, status, agent_id, worktree_branch,
        focus, players, baseline, best_result, best_experiment_id,
        total_input_tokens, total_output_tokens, total_cost_usd,
        conversation_history, permissions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    session.name,
    session.createdAt,
    session.updatedAt,
    session.status,
    session.agentId ?? null,
    session.worktreeBranch ?? null,
    session.focus ?? null,
    toJson(session.players),
    toJson(session.baseline),
    toJson(session.bestResult),
    session.bestExperimentId ?? null,
    session.totalInputTokens,
    session.totalOutputTokens,
    session.totalCostUsd,
    toJson(session.conversationHistory),
    toJson((session as any).permissions ?? null),
  );

  const sid = session.id;

  // -- Experiments --
  db.prepare("DELETE FROM experiments WHERE session_id = ?").run(sid);
  const insertExp = db.prepare(
    `INSERT INTO experiments
       (id, session_id, number, timestamp, hypothesis, category,
        code_changes, config_changes, players, positions_evaluated,
        evaluation_duration_ms, result, delta, significance, conclusion,
        notes, next_steps, oracle_query_id, archetype, hypothesis_set_id,
        hypothesis_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const exp of session.experiments) {
    insertExp.run(
      exp.id,
      exp.sessionId ?? sid,
      exp.number,
      exp.timestamp,
      exp.hypothesis,
      exp.category,
      toJson(exp.codeChanges),
      toJson(exp.configChanges),
      toJson(exp.players),
      exp.positionsEvaluated,
      exp.evaluationDurationMs,
      toJson(exp.result),
      toJson(exp.delta),
      toJson(exp.significance),
      exp.conclusion,
      exp.notes,
      toJson(exp.nextSteps),
      exp.oracleQueryId ?? null,
      exp.archetype ?? null,
      exp.hypothesisSetId ?? null,
      exp.hypothesisLevel ?? null,
    );
  }

  // -- Oracle consultations --
  db.prepare("DELETE FROM oracle_consultations WHERE session_id = ?").run(sid);
  const insertOracle = db.prepare(
    `INSERT INTO oracle_consultations
       (id, session_id, timestamp, question, domain, claude_initial,
        chatgpt_response, claude_final, action_items, confidence, query_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const oc of session.oracleConsultations) {
    insertOracle.run(
      oc.id,
      sid,
      oc.timestamp,
      oc.question,
      oc.domain,
      oc.claudeInitial,
      oc.chatgptResponse,
      oc.claudeFinal,
      toJson(oc.actionItems),
      oc.confidence,
      oc.queryType ?? null,
    );
  }

  // -- Interactions --
  db.prepare("DELETE FROM interactions WHERE session_id = ?").run(sid);
  const insertInteraction = db.prepare(
    `INSERT INTO interactions
       (id, session_id, timestamp, provider, model, input_tokens,
        output_tokens, cost_usd, purpose, label, sent_summary,
        received_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const ir of session.interactions) {
    insertInteraction.run(
      ir.id,
      sid,
      ir.timestamp,
      ir.provider,
      ir.model,
      ir.inputTokens,
      ir.outputTokens,
      ir.costUsd,
      ir.purpose,
      ir.label,
      ir.sentSummary,
      ir.receivedSummary,
    );
  }

  // -- Hypothesis sets --
  db.prepare("DELETE FROM hypothesis_sets WHERE session_id = ?").run(sid);
  const insertHyp = db.prepare(
    `INSERT INTO hypothesis_sets
       (id, session_id, timestamp, hypotheses, committed_level,
        commitment_rationale, cost_of_being_wrong)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const hs of session.hypothesisSets ?? []) {
    insertHyp.run(
      hs.id,
      hs.sessionId ?? sid,
      hs.timestamp,
      toJson(hs.hypotheses),
      hs.committedLevel,
      hs.commitmentRationale,
      hs.costOfBeingWrong,
    );
  }

  // -- Oracle surprises --
  db.prepare("DELETE FROM oracle_surprises WHERE session_id = ?").run(sid);
  const insertSurprise = db.prepare(
    `INSERT OR REPLACE INTO oracle_surprises
       (oracle_id, session_id, timestamp, prior_expectation,
        was_surprising, surprise_explanation)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const os of session.oracleSurprises ?? []) {
    insertSurprise.run(
      os.oracleId,
      sid,
      os.timestamp,
      os.priorExpectation,
      os.wasSurprising ? 1 : 0,
      os.surpriseExplanation ?? null,
    );
  }

  // -- Kill signals --
  db.prepare("DELETE FROM kill_signals WHERE session_id = ?").run(sid);
  const insertKill = db.prepare(
    `INSERT INTO kill_signals
       (id, session_id, timestamp, hypothesis_set_id, description,
        abandonment_point, reason, first_oracle_type,
        surprise_rate_at_abandonment, experiments_completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const ks of session.killSignals ?? []) {
    insertKill.run(
      ks.id,
      sid,
      ks.timestamp,
      ks.hypothesisSetId,
      ks.description,
      ks.abandonmentPoint,
      ks.reason,
      ks.firstOracleType,
      ks.surpriseRateAtAbandonment,
      ks.experimentsCompleted,
    );
  }

  // -- Reflections --
  db.prepare("DELETE FROM reflections WHERE session_id = ?").run(sid);
  const insertReflection = db.prepare(
    `INSERT INTO reflections
       (id, session_id, timestamp, after_experiment_number, ruled_out,
        surprise_rate_analysis, unexpected_result_description,
        current_surprise_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of session.reflections ?? []) {
    insertReflection.run(
      r.id,
      r.sessionId ?? sid,
      r.timestamp,
      r.afterExperimentNumber,
      r.ruledOut,
      r.surpriseRateAnalysis,
      r.unexpectedResultDescription,
      r.currentSurpriseRate,
    );
  }

  // -- Active changes --
  db.prepare("DELETE FROM active_changes WHERE session_id = ?").run(sid);
  const insertChange = db.prepare(
    `INSERT INTO active_changes
       (id, session_id, timestamp, file, description, hypothesis, diff, type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const ac of session.activeChanges) {
    insertChange.run(
      ac.id,
      sid,
      ac.timestamp,
      ac.file,
      ac.description,
      ac.hypothesis,
      ac.diff,
      ac.type,
    );
  }
}

/* ── Persist a single agent + session history ────────────── */

function persistAgent(agent: ForgeAgent): void {
  const db = getForgeDb();

  db.prepare(
    `INSERT OR REPLACE INTO agents
       (id, name, created_at, updated_at, status, current_session_id,
        config, total_input_tokens, total_output_tokens, total_cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    agent.id,
    agent.name,
    agent.createdAt,
    agent.updatedAt,
    agent.status,
    agent.currentSessionId ?? null,
    toJson(agent.config),
    agent.totalInputTokens,
    agent.totalOutputTokens,
    agent.totalCostUsd,
  );

  // Replace session history rows
  db.prepare("DELETE FROM agent_session_history WHERE agent_id = ?").run(agent.id);
  const insertHistory = db.prepare(
    `INSERT INTO agent_session_history
       (agent_id, session_id, session_name, started_at, ended_at,
        end_reason, decision)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const entry of agent.sessionHistory) {
    insertHistory.run(
      agent.id,
      entry.sessionId,
      entry.sessionName,
      entry.startedAt,
      entry.endedAt ?? null,
      entry.endReason ?? null,
      toJson(entry.decision ?? null),
    );
  }
}

/* ── Legacy JSON migration ───────────────────────────────── */

/** Migrate v1 state to v2: add agents array and agentId to sessions */
function migrateState(state: any): ForgeState {
  if (!state.agents) state.agents = [];
  if (state.version === 1) {
    for (const s of state.sessions) {
      if (s.agentId === undefined) s.agentId = null;
    }
    state.version = 2;
  }
  return state as ForgeState;
}

function migrateFromJson(): ForgeState | null {
  if (!existsSync(LEGACY_STATE_PATH)) return null;

  try {
    const raw = readFileSync(LEGACY_STATE_PATH, "utf-8");
    const state = migrateState(JSON.parse(raw));
    return state;
  } catch (err) {
    console.error(`  ✗ Failed to load legacy forge-state.json: ${err}`);
    return null;
  }
}

/* ── Public API ──────────────────────────────────────────── */

export function loadState(): ForgeState {
  const db = getForgeDb();

  // Check if the DB has any sessions — if empty, try one-time JSON migration
  const sessionCount = (
    db.prepare("SELECT COUNT(*) as cnt FROM sessions").get() as { cnt: number }
  ).cnt;

  if (sessionCount === 0) {
    const legacy = migrateFromJson();
    if (legacy) {
      // Persist the legacy state into SQLite and return it
      saveState(legacy);
      return legacy;
    }

    // No data at all — return empty state
    return {
      version: 2,
      sessions: [],
      agents: [],
      activeSessionId: null,
      lastCheckpoint: new Date().toISOString(),
    };
  }

  // Load from SQLite
  const loadAll = db.transaction(() => {
    // -- Sessions --
    const sessionRows = db
      .prepare("SELECT * FROM sessions ORDER BY created_at")
      .all() as any[];
    const sessions: ForgeSession[] = sessionRows.map(rowToSession);

    for (const session of sessions) {
      loadSessionNested(session);
    }

    // -- Agents --
    const agentRows = db
      .prepare("SELECT * FROM agents ORDER BY created_at")
      .all() as any[];
    const agents: ForgeAgent[] = agentRows.map(rowToAgent);

    for (const agent of agents) {
      agent.sessionHistory = (
        db
          .prepare(
            "SELECT * FROM agent_session_history WHERE agent_id = ? ORDER BY started_at",
          )
          .all(agent.id) as any[]
      ).map(rowToSessionEntry);
    }

    // -- Meta --
    const activeSessionId = getMeta("activeSessionId") ?? null;
    const lastCheckpoint = getMeta("lastCheckpoint") ?? new Date().toISOString();

    return {
      version: 2 as const,
      sessions,
      agents,
      activeSessionId,
      lastCheckpoint,
    };
  });

  return loadAll();
}

export function saveState(state: ForgeState): void {
  const db = getForgeDb();
  state.lastCheckpoint = new Date().toISOString();

  const writeAll = db.transaction(() => {
    // -- Meta --
    setMeta("activeSessionId", state.activeSessionId ?? null);
    setMeta("lastCheckpoint", state.lastCheckpoint);
    setMeta("version", String(state.version));

    // -- Sessions --
    // Collect IDs we want to keep, remove stale ones
    const keepSessionIds = new Set(state.sessions.map((s) => s.id));
    const existingIds = (
      db.prepare("SELECT id FROM sessions").all() as { id: string }[]
    ).map((r) => r.id);
    for (const id of existingIds) {
      if (!keepSessionIds.has(id)) {
        deleteSessionData(id);
      }
    }
    for (const session of state.sessions) {
      persistSession(session);
    }

    // -- Agents --
    const keepAgentIds = new Set(state.agents.map((a) => a.id));
    const existingAgentIds = (
      db.prepare("SELECT id FROM agents").all() as { id: string }[]
    ).map((r) => r.id);
    for (const id of existingAgentIds) {
      if (!keepAgentIds.has(id)) {
        db.prepare("DELETE FROM agents WHERE id = ?").run(id);
        db.prepare("DELETE FROM agent_session_history WHERE agent_id = ?").run(id);
      }
    }
    for (const agent of state.agents) {
      persistAgent(agent);
    }
  });

  writeAll();
}

export function getActiveSession(state: ForgeState): ForgeSession | null {
  if (!state.activeSessionId) return null;
  return state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
}

export function updateSession(
  state: ForgeState,
  sessionId: string,
  updater: (session: ForgeSession) => void,
): void {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  updater(session);
  session.updatedAt = new Date().toISOString();

  // Persist only this session + meta to SQLite
  const db = getForgeDb();
  const writeSession = db.transaction(() => {
    persistSession(session);
    setMeta("activeSessionId", state.activeSessionId ?? null);
    setMeta("lastCheckpoint", new Date().toISOString());
  });
  writeSession();

  state.lastCheckpoint = new Date().toISOString();
}

export function updateAgent(
  state: ForgeState,
  agentId: string,
  updater: (agent: ForgeAgent) => void,
): void {
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  updater(agent);
  agent.updatedAt = new Date().toISOString();

  // Persist only this agent to SQLite
  const db = getForgeDb();
  const writeAgent = db.transaction(() => {
    persistAgent(agent);
    setMeta("lastCheckpoint", new Date().toISOString());
  });
  writeAgent();

  state.lastCheckpoint = new Date().toISOString();
}

/* ── Internal cleanup helper ─────────────────────────────── */

function deleteSessionData(sessionId: string): void {
  const db = getForgeDb();
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  db.prepare("DELETE FROM experiments WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM oracle_consultations WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM interactions WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM hypothesis_sets WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM oracle_surprises WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM kill_signals WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM reflections WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM active_changes WHERE session_id = ?").run(sessionId);
}

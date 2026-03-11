/**
 * The `forge` API object — the composable surface exposed to the REPL.
 *
 * This ties together all modules into a single namespace hierarchy.
 * The agent interacts with `forge.code.*`, `forge.config.*`,
 * `forge.eval.*`, etc. — 30+ composable methods.
 */

import type { SandboxInfo } from "./sandbox";
import type {
  ForgeSession, ForgeState, MaiaMetrics, OracleRecord,
  SessionStatus, ExperimentRecord, ExperimentArchetype,
  KillSignalRecord, ReflectionCheckpoint, OracleSurpriseEntry,
  HypothesisSet, LeaderboardEntry,
} from "../state/types";
import type { AgentStats } from "../state/leaderboard-db";
import type { TestResult, PositionResult, Metrics } from "@outprep/harness";
import type { LichessGame } from "@outprep/harness";

import { createCodeOps, type CodeOps } from "./code-ops";
import { createConfigOps, type ConfigOps } from "./config-ops";
import { createEvalOps, type EvalOps, type ComparisonTable } from "./eval-ops";
import { createSessionOps, type SessionOps } from "./session-ops";

import { fetchPlayer, getGames, listPlayers as listCachedPlayers } from "../data/game-store";
import { getForgeDb } from "../state/forge-db";
import { requestPermission, getPendingPermissions } from "../tools/permissions";
import { createSplit } from "../data/splits";
import { computeMoveAccuracy } from "../metrics/move-accuracy";
import { computeCPLDistribution } from "../metrics/cpl-distribution";
import { computeBlunderProfile } from "../metrics/blunder-profile";
import { computeMaiaMetrics } from "../metrics/maia-scorer";
import { computeSignificance } from "../metrics/significance";
import {
  loadTopic, searchTopics, appendToTopic,
  createTopic, compactTopic, loadArchives,
  addNote, loadNotes, searchNotes,
  type Topic, type TopicArchive, type AgentNote,
} from "../knowledge/index";
import { consultOracle } from "../oracle/oracle";
import { createOracleLimiter } from "../oracle/oracle-limiter";
import { createSurpriseTracker, type SurpriseHealthAssessment } from "../oracle/surprise-tracker";
import { detectIncrementalPattern } from "../oracle/incremental-detector";
import { createHypothesisOps, type HypothesisOps } from "../hypothesis/hypothesis-manager";
import { createWebTools, type WebTools, type SearchResult } from "../tools/web-tools";
import { writeExperimentLog } from "../log/log-formatter";
import { computeTrend, formatTrend } from "../log/trend-tracker";
import { randomUUID } from "node:crypto";
import { updateSession, saveState } from "../state/forge-state";

/* ── Namespace types ──────────────────────────────────────── */

export interface DataOps {
  load(username: string): Promise<import("../state/types").PlayerData>;
  split(games: LichessGame[], opts?: { seed?: number; trainRatio?: number }): {
    trainGames: LichessGame[];
    testGames: LichessGame[];
    split: import("../state/types").DataSplit;
  };
  getGames(username: string): LichessGame[];
  listPlayers(): import("../state/types").PlayerData[];
}

export interface MetricsOps {
  accuracy(positions: PositionResult[]): ReturnType<typeof computeMoveAccuracy>;
  cplDistribution(positions: PositionResult[]): ReturnType<typeof computeCPLDistribution>;
  blunderProfile(positions: PositionResult[]): ReturnType<typeof computeBlunderProfile>;
  composite(positions: PositionResult[], rawMetrics: Metrics): MaiaMetrics;
  significance(
    metricName: string,
    baselineValues: number[],
    experimentValues: number[]
  ): import("../state/types").SignificanceResult;
}

export interface KnowledgeOps {
  search(query: string): Topic[];
  read(topicId: string): Topic | null;
  append(topicId: string, entry: { session: string; date: string; summary: string }): void;
  create(opts: { id: string; title: string; relevance: string[]; content: string }): Topic;
  compact(topicId: string, keepRecent?: number): TopicArchive | null;
  archives(topicId: string): TopicArchive[];
  note(content: string, tags?: string[]): AgentNote;
  notes(opts?: { limit?: number; tags?: string[] }): AgentNote[];
  searchNotes(query: string): AgentNote[];
}

export interface SessionSummary {
  id: string;
  name: string;
  status: SessionStatus;
  focus: string;
  players: string[];
  experimentCount: number;
  bestCompositeScore: number | null;
  createdAt: string;
  totalCostUsd: number;
}

export interface ExperimentHit {
  experimentId: string;
  sessionName: string;
  hypothesis: string;
  category: string;
  conclusion: string;
  compositeScore: number;
  compositeDelta: number;
  notes: string;
}

export interface HistoryOps {
  sessions(opts?: { status?: SessionStatus; player?: string }): SessionSummary[];
  searchExperiments(query: string): ExperimentHit[];
  experiment(experimentId: string): ExperimentRecord | null;
}

export interface OracleOps {
  ask(question: string, context?: string, queryType?: "adversarial" | "confirmatory" | "exploratory"): Promise<OracleRecord>;
  history(): OracleRecord[];
  /** Get current surprise rate and health assessment */
  surpriseRate(): SurpriseHealthAssessment;
  /** Record the agent's surprise/expectation after an oracle result */
  recordSurprise(oracleId: string, priorExpectation: string, wasSurprising: boolean, explanation?: string): void;
}

export interface LogOps {
  record(experiment: Partial<import("../state/types").ExperimentRecord> & { hypothesis: string }): string;
  trend(): ReturnType<typeof computeTrend>;
  summary(): string;
  /** Record a kill signal when abandoning an experiment or hypothesis */
  kill(signal: Omit<KillSignalRecord, "id" | "timestamp">): string;
  /** Record a reflection checkpoint */
  reflect(reflection: Omit<ReflectionCheckpoint, "id" | "sessionId" | "timestamp">): string;
}

export interface ToolOps {
  /** Submit an eval job for a player (blocking -- agent waits) */
  evalPlayer(username: string): string;
  /** Check tool job status */
  status(jobId: string): { status: string; output?: any; error?: string } | null;
  /** List tool jobs for current session */
  list(): any[];
}

export interface PermissionOps {
  /** Request a new permission */
  request(type: string, details: Record<string, any>): string;
  /** List pending permission requests for current session */
  pending(): any[];
}

export interface WebOps {
  /** Search the web for relevant information */
  search(query: string): Promise<SearchResult[]>;
  /** Fetch a URL and extract text content (HTML → markdown) */
  fetch(url: string, prompt?: string): Promise<string>;
}

export interface LeaderboardOps {
  /** View the current leaderboard (read-only) */
  get(): LeaderboardEntry[];
  /** View your own stats */
  me(): AgentStats | null;
}

/* ── Full API type ─────────────────────────────────────────── */

export interface ForgeApi {
  code: CodeOps;
  config: ConfigOps;
  eval: EvalOps;
  session: SessionOps;
  data: DataOps;
  metrics: MetricsOps;
  knowledge: KnowledgeOps;
  oracle: OracleOps;
  log: LogOps;
  history: HistoryOps;
  hypothesis: HypothesisOps;
  web: WebOps;
  tools: ToolOps;
  permissions: PermissionOps;
  /** Leaderboard access (read-only, injected by agent-manager) */
  leaderboard?: LeaderboardOps;
  /** File a feature request (injected by agent-manager) */
  request?: (title: string, description: string, category: string) => string;
  /** Callback fired after each experiment is recorded (injected by agent-manager) */
  _onExperimentRecorded?: () => void;
  compare(a: TestResult, b: TestResult): ComparisonTable;
}

/* ── Factory ───────────────────────────────────────────────── */

export function createForgeApi(
  sandbox: SandboxInfo,
  session: ForgeSession,
  state: ForgeState,
  playerDataRef?: Record<string, { trainGames: LichessGame[]; testGames: LichessGame[] }>
): ForgeApi {
  const codeOps = createCodeOps(sandbox);
  const configOps = createConfigOps(sandbox);
  const rawEvalOps = createEvalOps(sandbox);
  const sessionOps = createSessionOps(sandbox, session, state, codeOps, configOps);
  const oracleLimiter = createOracleLimiter();
  const surpriseTracker = createSurpriseTracker(session, state);
  const rawHypothesisOps = createHypothesisOps(session, state);

  // ── Web tools ──
  const rawWebTools = createWebTools();

  // Mutable ref for post-experiment callback (set by agent-manager via _onExperimentRecorded)
  const callbacks: { onExperimentRecorded?: () => void } = {};

  // ── Tool job logging helper ──
  // Logs non-blocking tool calls into tool_jobs for dashboard visibility
  function logToolJob<T>(toolName: string, input: any, run: () => Promise<T>): Promise<T> {
    const db = getForgeDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tool_jobs (id, session_id, agent_id, tool_name, status, input, created_at, blocking, retry_count)
       VALUES (?, ?, ?, ?, 'running', ?, ?, 0, 0)`
    ).run(id, session.id, session.agentId ?? null, toolName, JSON.stringify(input), now);
    return run().then((result) => {
      const output = typeof result === "object" ? JSON.stringify(result) : String(result);
      db.prepare(
        `UPDATE tool_jobs SET status = 'completed', output = ?, started_at = ?, completed_at = ? WHERE id = ?`
      ).run(output.length > 10000 ? output.slice(0, 10000) : output, now, new Date().toISOString(), id);
      return result;
    }).catch((err) => {
      db.prepare(
        `UPDATE tool_jobs SET status = 'failed', error = ?, started_at = ?, completed_at = ? WHERE id = ?`
      ).run((err as Error).message, now, new Date().toISOString(), id);
      throw err;
    });
  }

  function logToolJobSync<T>(toolName: string, input: any, run: () => T): T {
    const db = getForgeDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tool_jobs (id, session_id, agent_id, tool_name, status, input, created_at, blocking, retry_count)
       VALUES (?, ?, ?, ?, 'running', ?, ?, 0, 0)`
    ).run(id, session.id, session.agentId ?? null, toolName, JSON.stringify(input), now);
    try {
      const result = run();
      const output = typeof result === "string" ? result : JSON.stringify(result);
      db.prepare(
        `UPDATE tool_jobs SET status = 'completed', output = ?, started_at = ?, completed_at = ? WHERE id = ?`
      ).run(output.length > 10000 ? output.slice(0, 10000) : output, now, new Date().toISOString(), id);
      return result;
    } catch (err) {
      db.prepare(
        `UPDATE tool_jobs SET status = 'failed', error = ?, started_at = ?, completed_at = ? WHERE id = ?`
      ).run((err as Error).message, now, new Date().toISOString(), id);
      throw err;
    }
  }

  // Wrapped web tools that log to tool_jobs
  const webTools: WebTools = {
    search(query: string) {
      return logToolJob("web_search", { query }, () =>
        rawWebTools.search(query).then((results) => {
          // Store summary as output, return full results to caller
          return results;
        })
      );
    },
    fetch(url: string, prompt?: string) {
      return logToolJob("web_fetch", { url }, () =>
        rawWebTools.fetch(url, prompt)
      );
    },
  };

  // ── Experiment prerequisites gate ──────────────────────────
  // Prevents agents from looping on hypothesis regeneration + oracle
  // without doing real work. First hypothesis & one oracle query per
  // hypothesis set are ungated; subsequent calls require proof of work.
  let oracleQueriesSinceLastHypothesis = 0;

  function checkExperimentPrerequisites(): { met: boolean; message: string } {
    if (session.experiments.length === 0) {
      return { met: false, message: "No experiments recorded yet." };
    }
    const lastExp = session.experiments[session.experiments.length - 1];
    const issues: string[] = [];
    if (!lastExp.codeChanges || lastExp.codeChanges.length === 0)
      issues.push("- No code changes. Use forge.code.prompt(instruction) to modify engine code.");
    if (!lastExp.configChanges || lastExp.configChanges.length === 0)
      issues.push("- No config changes. Use forge.config.set(path, value) to modify configuration.");
    if (!lastExp.conclusion || lastExp.conclusion === "inconclusive")
      issues.push("- No clear conclusion. Use forge.log.record({ ..., conclusion: 'confirmed'|'refuted'|'partial' }).");
    if (issues.length > 0) {
      return {
        met: false,
        message: `Your last experiment (${lastExp.hypothesis.slice(0, 60)}) is missing:\n${issues.join("\n")}\n\nComplete your current experiment before generating new hypotheses or consulting the oracle.`,
      };
    }
    return { met: true, message: "" };
  }

  // Wrap hypothesis ops to gate 2nd+ commits behind experiment prerequisites
  const hypothesisOps: HypothesisOps = {
    ...rawHypothesisOps,
    commit(input) {
      // First hypothesis set is ungated — needed to bootstrap research
      if ((session.hypothesisSets ?? []).length >= 1) {
        const prereq = checkExperimentPrerequisites();
        if (!prereq.met) {
          throw new Error(
            `Cannot create a new hypothesis set yet.\n${prereq.message}\n\n` +
            `Required workflow: code changes → config changes → eval → forge.log.record() with conclusion → THEN forge.hypothesis.commit()`
          );
        }
      }
      oracleQueriesSinceLastHypothesis = 0;
      return rawHypothesisOps.commit(input);
    },
  };

  // Infer trainGames from playerData when not explicitly provided
  function inferTrainGames(testGames: LichessGame[]): LichessGame[] | undefined {
    if (!playerDataRef) return undefined;
    for (const pd of Object.values(playerDataRef)) {
      if (pd.testGames === testGames) return pd.trainGames;
    }
    return undefined;
  }

  // Wrap eval ops to auto-inject trainGames from playerData
  const evalOps: EvalOps = {
    async run(testGames, opts = {}) {
      if (!opts.trainGames) opts.trainGames = inferTrainGames(testGames);
      return rawEvalOps.run(testGames, opts);
    },
    async runQuick(testGames, trainGames?, n?) {
      return rawEvalOps.runQuick(testGames, trainGames ?? inferTrainGames(testGames), n);
    },
    async baseline(testGames, trainGames?) {
      return rawEvalOps.baseline(testGames, trainGames ?? inferTrainGames(testGames));
    },
    compare: rawEvalOps.compare.bind(rawEvalOps),
  };

  // ── Data namespace ──
  const data: DataOps = {
    async load(username: string) {
      return fetchPlayer(username);
    },
    split(games: LichessGame[], opts?: { seed?: number; trainRatio?: number }) {
      return createSplit(games, opts);
    },
    getGames(username: string) {
      return getGames(username);
    },
    listPlayers() {
      return listCachedPlayers();
    },
  };

  // ── Metrics namespace ──
  const metrics: MetricsOps = {
    accuracy(positions: PositionResult[]) {
      return computeMoveAccuracy(positions);
    },
    cplDistribution(positions: PositionResult[]) {
      return computeCPLDistribution(positions);
    },
    blunderProfile(positions: PositionResult[]) {
      return computeBlunderProfile(positions);
    },
    composite(positions: PositionResult[], rawMetrics: Metrics) {
      return computeMaiaMetrics(positions, rawMetrics);
    },
    significance(metricName: string, baselineValues: number[], experimentValues: number[]) {
      return computeSignificance(metricName, baselineValues, experimentValues);
    },
  };

  // ── Knowledge namespace ──
  const knowledge: KnowledgeOps = {
    search(query: string) {
      return searchTopics(query);
    },
    read(topicId: string) {
      return loadTopic(topicId);
    },
    append(topicId: string, entry: { session: string; date: string; summary: string }) {
      appendToTopic(topicId, entry);
    },
    create(opts: { id: string; title: string; relevance: string[]; content: string }) {
      return createTopic(opts);
    },
    compact(topicId: string, keepRecent?: number) {
      return compactTopic(topicId, keepRecent != null ? { keepRecent } : undefined);
    },
    archives(topicId: string) {
      return loadArchives(topicId);
    },
    note(content: string, tags?: string[]) {
      return addNote({
        sessionId: session.id,
        sessionName: session.name,
        tags: tags ?? [],
        content,
      });
    },
    notes(opts?: { limit?: number; tags?: string[] }) {
      return loadNotes(opts);
    },
    searchNotes(query: string) {
      return searchNotes(query);
    },
  };

  // ── History namespace ──
  const history: HistoryOps = {
    sessions(opts?: { status?: SessionStatus; player?: string }) {
      return state.sessions
        .filter((s) => s.id !== session.id) // exclude current
        .filter((s) => !opts?.status || s.status === opts.status)
        .filter((s) => !opts?.player || s.players.includes(opts.player))
        .map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          focus: s.focus ?? "accuracy",
          players: s.players,
          experimentCount: s.experiments.length,
          bestCompositeScore: s.bestResult?.compositeScore ?? null,
          createdAt: s.createdAt,
          totalCostUsd: s.totalCostUsd,
        }));
    },
    searchExperiments(query: string) {
      const queryWords = query.toLowerCase().split(/\s+/);
      const hits: { hit: ExperimentHit; score: number }[] = [];

      for (const s of state.sessions) {
        for (const exp of s.experiments) {
          let score = 0;
          const hypothesis = exp.hypothesis.toLowerCase();
          const notes = exp.notes.toLowerCase();
          const category = exp.category.toLowerCase();

          for (const word of queryWords) {
            if (hypothesis.includes(word)) score += 3;
            if (category.includes(word)) score += 2;
            const contentMatches = (notes.match(new RegExp(word, "g")) ?? []).length;
            score += Math.min(contentMatches, 3);
          }

          if (score > 0) {
            hits.push({
              score,
              hit: {
                experimentId: exp.id,
                sessionName: s.name,
                hypothesis: exp.hypothesis,
                category: exp.category,
                conclusion: exp.conclusion,
                compositeScore: exp.result.compositeScore,
                compositeDelta: exp.delta.compositeScore,
                notes: exp.notes.length > 300 ? exp.notes.slice(0, 300) + "..." : exp.notes,
              },
            });
          }
        }
      }

      return hits
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map((h) => h.hit);
    },
    experiment(experimentId: string) {
      for (const s of state.sessions) {
        const exp = s.experiments.find((e) => e.id === experimentId);
        if (exp) return exp;
      }
      return null;
    },
  };

  // ── Oracle namespace ──
  const oracle: OracleOps = {
    async ask(question: string, context?: string, queryType?: "adversarial" | "confirmatory" | "exploratory") {
      // Experiment prerequisites gate: one free oracle query per hypothesis set,
      // then requires experiment work before further queries
      if ((session.hypothesisSets ?? []).length >= 1 && oracleQueriesSinceLastHypothesis >= 1) {
        const prereq = checkExperimentPrerequisites();
        if (!prereq.met) {
          throw new Error(
            `Cannot consult the oracle yet.\n${prereq.message}\n\n` +
            `Run at least one experiment with code changes, config changes, and a conclusion before querying the oracle again.`
          );
        }
      }
      oracleQueriesSinceLastHypothesis++;

      const effectiveQueryType = queryType ?? "exploratory";

      // Check oracle limiter
      const currentHypothesis = hypothesisOps.current();
      const archetype: ExperimentArchetype =
        currentHypothesis?.committedLevel === "groundbreaking" ? "exploratory" : "incremental";
      const limiterCheck = oracleLimiter.canQuery(effectiveQueryType);
      if (!limiterCheck.allowed) {
        throw new Error(`Oracle query blocked: ${limiterCheck.reason}`);
      }

      // Detect incremental tuning pattern
      const detection = detectIncrementalPattern(session.oracleConsultations, session.experiments);
      if (detection.detected) {
        console.warn(`  ⚠ ${detection.message}`);
      }

      const record = await logToolJob(
        "oracle",
        { question: question.slice(0, 200), queryType: effectiveQueryType },
        async () => {
          const { record, interactions } = await consultOracle({
            question,
            domain: "chess-engine-optimization",
            context: context ?? "",
            queryType: effectiveQueryType,
          });

          // Track query in limiter
          oracleLimiter.recordQuery(effectiveQueryType);

          // Record in session
          updateSession(state, session.id, (s) => {
            s.oracleConsultations.push(record);
            if (!s.interactions) s.interactions = [];
            s.interactions.push(...interactions);
            for (const ix of interactions) {
              s.totalInputTokens += ix.inputTokens;
              s.totalOutputTokens += ix.outputTokens;
              s.totalCostUsd += ix.costUsd;
            }
          });
          return record;
        },
      );
      return record;
    },
    history() {
      return session.oracleConsultations;
    },
    surpriseRate() {
      return surpriseTracker.getHealthAssessment();
    },
    recordSurprise(oracleId: string, priorExpectation: string, wasSurprising: boolean, explanation?: string) {
      surpriseTracker.record({
        oracleId,
        priorExpectation,
        wasSurprising,
        surpriseExplanation: explanation,
      });
    },
  };

  // ── Log namespace ──
  const log: LogOps = {
    record(partial) {
      const emptyPhase = { opening: 0, middlegame: 0, endgame: 0, overall: 0 };
      const emptyResult: import("../state/types").MaiaMetrics = {
        moveAccuracy: 0,
        moveAccuracyByPhase: { ...emptyPhase },
        cplKLDivergence: 0,
        cplKSStatistic: 0,
        cplKSPValue: 0,
        cplByPhase: {},
        blunderRateDelta: { ...emptyPhase },
        mistakeRateDelta: { ...emptyPhase },
        compositeScore: 0,
        rawMetrics: {
          totalPositions: 0, matchRate: 0, topNRate: 0, bookCoverage: 0,
          avgActualCPL: NaN, avgBotCPL: NaN, cplDelta: NaN,
          byPhase: {
            opening: { positions: 0, matchRate: 0, topNRate: 0, avgCPL: NaN, botAvgCPL: NaN },
            middlegame: { positions: 0, matchRate: 0, topNRate: 0, avgCPL: NaN, botAvgCPL: NaN },
            endgame: { positions: 0, matchRate: 0, topNRate: 0, avgCPL: NaN, botAvgCPL: NaN },
          },
        },
        positionsEvaluated: 0,
      };

      // Validate/coerce result field — agent may pass wrong shape
      let coercedResult = partial.result;
      if (coercedResult && !("moveAccuracy" in coercedResult)) {
        // Agent passed a custom object or raw TestResult.metrics instead of MaiaMetrics
        const raw = coercedResult as Record<string, unknown>;
        if ("matchRate" in raw) {
          // Attempt to coerce raw metrics → MaiaMetrics shape
          coercedResult = {
            ...emptyResult,
            moveAccuracy: (raw.matchRate as number) ?? 0,
            rawMetrics: coercedResult as MaiaMetrics["rawMetrics"],
          } as MaiaMetrics;
        } else {
          // Unrecognized shape — fall back to empty
          console.warn("[forge.log.record] result has wrong shape, using empty defaults");
          coercedResult = undefined;
        }
      }

      // Guard: reject experiments with too few positions for statistical validity.
      // This catches the case where games lack Stockfish analysis (0 positions evaluated)
      // and the agent tries to record a bogus "confirmed" result.
      const effectivePositions = partial.positionsEvaluated
        ?? coercedResult?.positionsEvaluated
        ?? 0;
      if (effectivePositions < 20) {
        throw new Error(
          `Cannot record experiment with only ${effectivePositions} positions evaluated. ` +
          `Minimum 20 positions required for statistical validity. ` +
          `Ensure player games have Stockfish analysis before running experiments.`
        );
      }

      // Auto-populate hypothesis/archetype from current hypothesis set
      const currentHypothesisSet = hypothesisOps.current();
      const autoArchetype: ExperimentArchetype =
        currentHypothesisSet?.committedLevel === "groundbreaking" ? "exploratory" : "incremental";

      // Notify oracle limiter that an eval has run (burn-in complete)
      oracleLimiter.completeBurnIn();

      // Fill in defaults for missing fields
      const experiment: ExperimentRecord = {
        id: partial.id ?? randomUUID(),
        sessionId: partial.sessionId ?? session.id,
        number: partial.number ?? session.experiments.length + 1,
        timestamp: partial.timestamp ?? new Date().toISOString(),
        hypothesis: partial.hypothesis!,
        category: partial.category ?? "parameter",
        codeChanges: partial.codeChanges ?? [...codeOps.getTrackedChanges()],
        configChanges: partial.configChanges ?? [],
        players: partial.players ?? session.players,
        positionsEvaluated: partial.positionsEvaluated ?? 0,
        evaluationDurationMs: partial.evaluationDurationMs ?? 0,
        result: coercedResult ?? emptyResult,
        delta: partial.delta ?? { moveAccuracy: 0, cplKLDivergence: 0, blunderRateDelta: 0, compositeScore: 0 },
        significance: partial.significance ?? [],
        conclusion: partial.conclusion ?? "inconclusive",
        notes: partial.notes ?? "",
        nextSteps: partial.nextSteps ?? [],
        oracleQueryId: partial.oracleQueryId,
        archetype: partial.archetype ?? autoArchetype,
        hypothesisSetId: partial.hypothesisSetId ?? currentHypothesisSet?.id,
        hypothesisLevel: partial.hypothesisLevel ?? currentHypothesisSet?.committedLevel,
      };

      // Write markdown log (non-fatal — experiment still gets recorded on failure)
      let path = "";
      try {
        path = writeExperimentLog(session.name, experiment);
      } catch (err) {
        console.warn("[forge.log.record] markdown log failed:", (err as Error).message);
        path = `(log write failed: ${(err as Error).message})`;
      }

      // Add to session experiments
      updateSession(state, session.id, (s) => {
        s.experiments.push(experiment);
        // Update best result
        if (
          !s.bestResult ||
          experiment.result.compositeScore > s.bestResult.compositeScore
        ) {
          s.bestResult = experiment.result;
          s.bestExperimentId = experiment.id;
        }
      });

      // Notify agent-manager to update leaderboard incrementally
      try { callbacks.onExperimentRecorded?.(); } catch { /* non-fatal */ }

      return path;
    },
    trend() {
      return computeTrend(session.experiments);
    },
    summary() {
      const trend = computeTrend(session.experiments);
      return formatTrend(trend);
    },
    kill(signal: Omit<KillSignalRecord, "id" | "timestamp">) {
      const record: KillSignalRecord = {
        ...signal,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
      };
      updateSession(state, session.id, (s) => {
        if (!s.killSignals) s.killSignals = [];
        s.killSignals.push(record);
      });
      console.log(`  Kill signal recorded: ${signal.description.slice(0, 80)}`);
      return record.id;
    },
    reflect(input: Omit<ReflectionCheckpoint, "id" | "sessionId" | "timestamp">) {
      const checkpoint: ReflectionCheckpoint = {
        ...input,
        id: randomUUID(),
        sessionId: session.id,
        timestamp: new Date().toISOString(),
      };
      updateSession(state, session.id, (s) => {
        if (!s.reflections) s.reflections = [];
        s.reflections.push(checkpoint);
      });
      console.log(`  Reflection checkpoint recorded after experiment #${input.afterExperimentNumber}`);
      return checkpoint.id;
    },
  };

  // ── Tools namespace ──
  const tools: ToolOps = {
    evalPlayer(username: string) {
      const db = getForgeDb();
      const id = randomUUID();
      db.prepare(`
        INSERT INTO tool_jobs (id, session_id, agent_id, tool_name, status, input, created_at, blocking)
        VALUES (?, ?, ?, 'eval_player', 'pending', ?, ?, 1)
      `).run(id, session.id, session.agentId ?? null, JSON.stringify({ username }), new Date().toISOString());
      console.log(`  Submitted eval job ${id.slice(0, 8)} for player "${username}"`);
      return id;
    },
    status(jobId: string) {
      const db = getForgeDb();
      const row = db.prepare(`SELECT status, output, error FROM tool_jobs WHERE id = ?`).get(jobId) as
        | { status: string; output: string | null; error: string | null }
        | undefined;
      if (!row) return null;
      return {
        status: row.status,
        ...(row.output != null ? { output: JSON.parse(row.output) } : {}),
        ...(row.error != null ? { error: row.error } : {}),
      };
    },
    list() {
      const db = getForgeDb();
      return db.prepare(
        `SELECT id, tool_name, status, created_at, completed_at FROM tool_jobs WHERE session_id = ? ORDER BY created_at DESC`,
      ).all(session.id);
    },
  };

  // ── Permissions namespace ──
  const permissions: PermissionOps = {
    request(type: string, details: Record<string, any>) {
      return requestPermission(session.id, session.agentId ?? null, type, details);
    },
    pending() {
      return getPendingPermissions(session.agentId ?? undefined);
    },
  };

  // Wrap code.prompt to log to tool_jobs
  const wrappedCodeOps: CodeOps = {
    ...codeOps,
    prompt(instruction: string): string {
      return logToolJobSync("code_prompt", { instruction: instruction.slice(0, 200) }, () =>
        codeOps.prompt(instruction),
      );
    },
  };

  const api: ForgeApi = {
    code: wrappedCodeOps,
    config: configOps,
    eval: evalOps,
    session: sessionOps,
    data,
    metrics,
    knowledge,
    oracle,
    log,
    history,
    hypothesis: hypothesisOps,
    web: webTools,
    tools,
    permissions,
    get _onExperimentRecorded() { return callbacks.onExperimentRecorded; },
    set _onExperimentRecorded(fn: (() => void) | undefined) { callbacks.onExperimentRecorded = fn; },
    compare(a: TestResult, b: TestResult) {
      return evalOps.compare(a, b);
    },
  };
  return api;
}

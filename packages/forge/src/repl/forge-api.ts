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
  SessionStatus, ExperimentRecord,
} from "../state/types";
import type { TestResult, PositionResult, Metrics } from "@outprep/harness";
import type { LichessGame } from "@outprep/harness";

import { createCodeOps, type CodeOps } from "./code-ops";
import { createConfigOps, type ConfigOps } from "./config-ops";
import { createEvalOps, type EvalOps, type ComparisonTable } from "./eval-ops";
import { createSessionOps, type SessionOps } from "./session-ops";

import { fetchPlayer, getGames, listPlayers as listCachedPlayers } from "../data/game-store";
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
import { writeExperimentLog } from "../log/log-formatter";
import { computeTrend, formatTrend } from "../log/trend-tracker";
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
  ask(question: string, context?: string): Promise<OracleRecord>;
  history(): OracleRecord[];
}

export interface LogOps {
  record(experiment: import("../state/types").ExperimentRecord): string;
  trend(): ReturnType<typeof computeTrend>;
  summary(): string;
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
  compare(a: TestResult, b: TestResult): ComparisonTable;
}

/* ── Factory ───────────────────────────────────────────────── */

export function createForgeApi(
  sandbox: SandboxInfo,
  session: ForgeSession,
  state: ForgeState
): ForgeApi {
  const codeOps = createCodeOps(sandbox);
  const configOps = createConfigOps(sandbox);
  const evalOps = createEvalOps(sandbox);
  const sessionOps = createSessionOps(sandbox, session, state, codeOps, configOps);

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
    async ask(question: string, context?: string) {
      const result = await consultOracle({
        question,
        domain: "chess-engine-optimization",
        context: context ?? "",
      });
      // Record in session
      updateSession(state, session.id, (s) => {
        s.oracleConsultations.push(result);
      });
      return result;
    },
    history() {
      return session.oracleConsultations;
    },
  };

  // ── Log namespace ──
  const log: LogOps = {
    record(experiment) {
      // Write markdown log
      const path = writeExperimentLog(session.name, experiment);

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

      return path;
    },
    trend() {
      return computeTrend(session.experiments);
    },
    summary() {
      const trend = computeTrend(session.experiments);
      return formatTrend(trend);
    },
  };

  return {
    code: codeOps,
    config: configOps,
    eval: evalOps,
    session: sessionOps,
    data,
    metrics,
    knowledge,
    oracle,
    log,
    history,
    compare(a: TestResult, b: TestResult) {
      return evalOps.compare(a, b);
    },
  };
}

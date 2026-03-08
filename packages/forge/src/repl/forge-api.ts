/**
 * The `forge` API object — the composable surface exposed to the REPL.
 *
 * This ties together all modules into a single namespace hierarchy.
 * The agent interacts with `forge.code.*`, `forge.config.*`,
 * `forge.eval.*`, etc. — 30+ composable methods.
 */

import type { SandboxInfo } from "./sandbox";
import type { ForgeSession, ForgeState, MaiaMetrics, OracleRecord } from "../state/types";
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
import { loadTopic, searchTopics, appendToTopic } from "../knowledge/index";
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
  search(query: string): ReturnType<typeof searchTopics>;
  read(topicId: string): ReturnType<typeof loadTopic>;
  append(topicId: string, entry: { session: string; date: string; summary: string }): void;
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
    compare(a: TestResult, b: TestResult) {
      return evalOps.compare(a, b);
    },
  };
}

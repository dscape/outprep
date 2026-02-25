/**
 * Harness-specific type definitions.
 */

import type { BotConfig, GamePhase, MoveSource } from "@outprep/engine";
import type { LichessGame } from "./lichess-types";
import type { VersionInfo } from "./version";

// ── Dataset ─────────────────────────────────────────────────────────

export interface Dataset {
  name: string;
  username: string;
  estimatedElo: number;
  speeds: string[];
  createdAt: string;
  gameCount: number;
  gamesWithEvals: number;
  games: LichessGame[];
}

// ── Run configuration ───────────────────────────────────────────────

export interface RunConfig {
  seed: number;
  label: string;
  eloOverride?: number;
  configOverrides?: Partial<BotConfig>;
  maxPositions?: number;
  /** Skip expensive top-N accuracy check (used in triage mode for speed) */
  skipTopN?: boolean;
}

// ── Position-level result ───────────────────────────────────────────

export interface PositionResult {
  gameIndex: number;
  ply: number;
  fen: string;
  phase: GamePhase;
  actualUci: string;
  actualSan: string;
  botUci: string;
  botSource: MoveSource;
  isMatch: boolean;
  isInTopN: boolean;
  dynamicSkill: number;
  actualCPL?: number;
  botCPL?: number;
}

// ── Aggregate metrics ───────────────────────────────────────────────

export interface PhaseMetrics {
  positions: number;
  matchRate: number;
  topNRate: number;
  avgCPL: number;
  botAvgCPL: number;
}

export interface Metrics {
  totalPositions: number;
  matchRate: number;
  topNRate: number;
  bookCoverage: number;
  avgActualCPL: number;
  avgBotCPL: number;
  cplDelta: number;
  byPhase: Record<GamePhase, PhaseMetrics>;
}

// ── Full test result ────────────────────────────────────────────────

export interface TestResult {
  datasetName: string;
  username: string;
  timestamp: string;
  seed: number;
  label: string;
  elo: number;
  configOverrides: Partial<BotConfig> | undefined;
  /** Git commit, package versions — traces which code produced this result */
  version: VersionInfo;
  /** Full resolved BotConfig (DEFAULT_CONFIG + overrides) at run time */
  resolvedConfig: BotConfig;
  metrics: Metrics;
  positions: PositionResult[];
}

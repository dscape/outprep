/**
 * Tuner state types — defines the data structures for the tuning loop,
 * sweep plans, experiment specs, and proposals.
 */

import type { BotConfig } from "@outprep/engine";
import type { Metrics } from "@outprep/harness";

/* ── Player Pool ─────────────────────────────────────────── */

export type EloBand =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "expert"
  | "master";

export interface PlayerEntry {
  username: string;
  band: EloBand;
  estimatedElo: number;
  datasetName?: string;
  lastFetched?: string; // ISO timestamp
}

export const ELO_BANDS: Record<EloBand, { min: number; max: number; targetPlayers: number }> = {
  beginner: { min: 1100, max: 1400, targetPlayers: 2 },
  intermediate: { min: 1400, max: 1700, targetPlayers: 2 },
  advanced: { min: 1700, max: 2000, targetPlayers: 2 },
  expert: { min: 2000, max: 2300, targetPlayers: 2 },
  master: { min: 2300, max: 3500, targetPlayers: 1 },
};

export interface DatasetRef {
  name: string;
  username: string;
  band: EloBand;
  elo: number;
  gameCount: number;
  path: string;
}

/* ── Sweep Plan ──────────────────────────────────────────── */

export type ExperimentStatus =
  | "pending"
  | "triage"
  | "promoted"
  | "running"
  | "complete"
  | "skipped";

export interface ExperimentSpec {
  id: string;
  parameter: string; // dot-path: "boltzmann.temperatureScale"
  description: string; // e.g. "temperatureScale ×0.7"
  configOverride: Partial<BotConfig>;
  datasets: string[]; // dataset names to run against
  maxPositions: number | null; // null = unlimited
  seed: number;
  status: ExperimentStatus;
  /** Triage score — set after triage run, used to decide promotion */
  triageScore?: number;
  /** Full result files per dataset — set after complete run */
  resultFiles?: string[];
}

export interface SweepPlan {
  baseConfig: BotConfig;
  baselineLabel: string;
  experiments: ExperimentSpec[];
  createdAt: string;
  status: "pending" | "running" | "complete";
}

/* ── Aggregated Results ──────────────────────────────────── */

export interface AggregatedResult {
  experimentId: string;
  parameter: string;
  description: string;
  configOverride: Partial<BotConfig>;
  /** Per-dataset metrics */
  datasetMetrics: { dataset: string; elo: number; metrics: Metrics }[];
  /** Weighted average across datasets */
  aggregatedMetrics: Metrics;
  /** Composite score (single scalar) */
  compositeScore: number;
  /** Delta from baseline */
  scoreDelta: number;
}

/* ── Proposals ───────────────────────────────────────────── */

export interface Proposal {
  cycle: number;
  timestamp: string;
  baselineScore: number;
  /** Full baseline metric breakdown (match%, top4%, CPL, etc.) */
  baselineMetrics?: Metrics;
  /** Per-dataset baseline metrics for strength calibration display */
  baselineDatasetMetrics?: { dataset: string; elo: number; metrics: Metrics }[];
  rankedExperiments: AggregatedResult[];
  proposedConfig: BotConfig;
  configChanges: ConfigChange[];
  summary: string;
  codeProposals: string[];
  nextPriorities: string[];
  /** Whether Claude API was used for analysis (false = statistical fallback) */
  usedClaudeAnalysis?: boolean;
}

export interface ConfigChange {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  scoreDelta: number;
  description: string;
}

/* ── Cycle History ───────────────────────────────────────── */

export interface CycleRecord {
  cycle: number;
  timestamp: string;
  datasetsUsed: number;
  experimentsRun: number;
  bestScoreDelta: number;
  accepted: boolean;
  configChanges: ConfigChange[];
  /** Baseline composite score for this cycle (tracks progression) */
  baselineScore?: number;
  /** Aggregate metrics snapshot for progression tracking */
  baselineMetrics?: Metrics;
  /** Per-dataset metrics snapshot for strength calibration history */
  baselineDatasetMetrics?: { dataset: string; elo: number; metrics: Metrics }[];
}

/* ── Tuner State (top-level persistence) ─────────────────── */

export type TunerPhase = "gather" | "sweep" | "analyze" | "waiting" | "idle";

export interface TunerState {
  version: 1;
  cycle: number;
  phase: TunerPhase;

  // Gather state
  playerPool: PlayerEntry[];
  datasets: DatasetRef[];

  // Sweep state
  currentPlan: SweepPlan | null;
  bestConfig: BotConfig;

  // History
  completedCycles: CycleRecord[];
  acceptedChanges: ConfigChange[];

  // Resume
  lastCheckpoint: string; // ISO timestamp
}

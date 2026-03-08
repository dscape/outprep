/**
 * Forge state types — defines data structures for autonomous research sessions,
 * experiments, metrics, and the REPL environment.
 */

import type { BotConfig } from "@outprep/engine";
import type { Metrics, PositionResult, TestResult } from "@outprep/harness";

/* ── Session ──────────────────────────────────────────────── */

export type SessionStatus = "active" | "paused" | "completed" | "abandoned";

export interface ForgeSession {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;

  /** Git worktree branch name */
  worktreeBranch: string;

  /** Players evaluated in this session */
  players: string[];

  /** Baseline metrics (computed at session start) */
  baseline: BaselineSnapshot | null;

  /** All experiments run */
  experiments: ExperimentRecord[];

  /** Best result achieved so far */
  bestResult: MaiaMetrics | null;
  bestExperimentId: string | null;

  /** Code changes currently applied in the sandbox */
  activeChanges: CodeChange[];

  /** Agent conversation history (for resume) */
  conversationHistory: ConversationMessage[];

  /** Cost tracking */
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;

  /** Oracle consultations */
  oracleConsultations: OracleRecord[];
}

/* ── Baseline ─────────────────────────────────────────────── */

export interface BaselineSnapshot {
  timestamp: string;
  config: BotConfig;
  /** Per-player baseline metrics */
  playerMetrics: PlayerMetricSnapshot[];
  /** Aggregate across all players */
  aggregate: MaiaMetrics;
  /** Dataset split hashes for reproducibility */
  splitHashes: Record<string, string>;
}

export interface PlayerMetricSnapshot {
  username: string;
  elo: number;
  metrics: MaiaMetrics;
  positionsEvaluated: number;
}

/* ── Maia-Aligned Metrics ─────────────────────────────────── */

export interface MaiaMetrics {
  /** Top-1 move prediction accuracy [0, 1] */
  moveAccuracy: number;
  /** Per-phase accuracy */
  moveAccuracyByPhase: PhaseValues;

  /** CPL distribution match (lower = better) */
  cplKLDivergence: number;
  cplKSStatistic: number;
  cplKSPValue: number;
  /** Per-phase CPL distribution */
  cplByPhase: Record<string, { klDivergence: number; ksStatistic: number }>;

  /** Blunder rate delta (|bot - player|, lower = better) */
  blunderRateDelta: PhaseValues;
  /** Mistake rate delta (|bot - player|, lower = better) */
  mistakeRateDelta: PhaseValues;

  /** Weighted composite score (higher = better) */
  compositeScore: number;

  /** Raw harness metrics for reference */
  rawMetrics: Metrics;

  /** Number of positions evaluated */
  positionsEvaluated: number;
}

export interface PhaseValues {
  opening: number;
  middlegame: number;
  endgame: number;
  overall: number;
}

/* ── Statistical Significance ─────────────────────────────── */

export interface SignificanceResult {
  metricName: string;
  baseline: number;
  experiment: number;
  delta: number;
  ci95: [number, number];
  pValue: number;
  effectSize: number; // Cohen's d
  significant: boolean; // p < 0.05 AND |d| > 0.2
}

/* ── Experiments ──────────────────────────────────────────── */

export interface ExperimentRecord {
  id: string;
  sessionId: string;
  number: number; // Sequential within session
  timestamp: string;

  /** What we're testing */
  hypothesis: string;
  category: "algorithm" | "parameter" | "architecture" | "data";

  /** Changes made */
  codeChanges: CodeChange[];
  configChanges: ConfigChangeRecord[];

  /** Evaluation details */
  players: string[];
  positionsEvaluated: number;
  evaluationDurationMs: number;

  /** Results */
  result: MaiaMetrics;
  delta: MaiaMetricsDelta;
  significance: SignificanceResult[];

  /** Analysis */
  conclusion: "confirmed" | "refuted" | "partial" | "inconclusive";
  notes: string;
  nextSteps: string[];

  /** Oracle consultation (if any) */
  oracleQueryId?: string;
}

export interface MaiaMetricsDelta {
  moveAccuracy: number;
  cplKLDivergence: number;
  blunderRateDelta: number;
  compositeScore: number;
}

/* ── Code Changes ─────────────────────────────────────────── */

export interface CodeChange {
  id: string;
  timestamp: string;
  /** Relative path within engine (e.g., "src/move-selector.ts") */
  file: string;
  description: string;
  hypothesis: string;
  diff: string;
  type: "code" | "config";
}

export interface ConfigChangeRecord {
  path: string; // dot-path: "boltzmann.temperatureScale"
  oldValue: unknown;
  newValue: unknown;
  description: string;
}

/* ── Oracle ────────────────────────────────────────────────── */

export interface OracleRecord {
  id: string;
  timestamp: string;
  question: string;
  domain: string;
  claudeInitial: string;
  chatgptResponse: string;
  claudeFinal: string;
  actionItems: string[];
  confidence: "high" | "medium" | "low";
}

/* ── Conversation (for agent resume) ──────────────────────── */

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

/* ── Data Management ──────────────────────────────────────── */

export interface PlayerData {
  username: string;
  estimatedElo: number;
  gameCount: number;
  contentHash: string;
  fetchedAt: string;
}

export interface DataSplit {
  username: string;
  seed: number;
  trainRatio: number;
  trainGameCount: number;
  testGameCount: number;
  trainPositionCount: number;
  testPositionCount: number;
  splitHash: string;
}

/* ── Eval Cache ───────────────────────────────────────────── */

export interface EvalCacheEntry {
  key: string; // SHA-256 of `${fen}:${depth}`
  fen: string;
  depth: number;
  score: number; // Centipawns from white's perspective
  bestMove: string; // UCI
  multiPV: string; // JSON-serialized CandidateMove[]
  sfVersion: string;
  created: string; // ISO timestamp
}

/* ── Top-Level Forge State ────────────────────────────────── */

export interface ForgeState {
  version: 1;
  /** All research sessions */
  sessions: ForgeSession[];
  /** Currently active session ID (null if none) */
  activeSessionId: string | null;
  /** Last checkpoint timestamp */
  lastCheckpoint: string;
}

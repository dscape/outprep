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

  /** Which agent owns this session (null for legacy sessions) */
  agentId: string | null;

  /** Git worktree branch name */
  worktreeBranch: string;

  /** Research focus area */
  focus: string;

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

  /** Per-API-call interaction records */
  interactions: InteractionRecord[];

  /** Hypothesis sets generated during this session */
  hypothesisSets?: HypothesisSet[];
  /** Oracle surprise tracking entries */
  oracleSurprises?: OracleSurpriseEntry[];
  /** Kill signal records */
  killSignals?: KillSignalRecord[];
  /** Reflection checkpoints */
  reflections?: ReflectionCheckpoint[];
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

  /** Experiment archetype */
  archetype?: ExperimentArchetype;
  /** Which hypothesis set this experiment is testing */
  hypothesisSetId?: string;
  /** Which specific hypothesis level is being tested */
  hypothesisLevel?: HypothesisLevel;
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

  /** Whether this query was adversarial (seeking disconfirmation) */
  queryType?: "adversarial" | "confirmatory" | "exploratory";
}

/* ── Interaction Records (per-API-call tracking) ─────────── */

export interface InteractionRecord {
  id: string;
  timestamp: string;
  provider: "claude" | "chatgpt";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  purpose: "agent-turn" | "oracle-initial" | "oracle-review" | "oracle-synthesis";
  label: string;
  sentSummary: string;
  receivedSummary: string;
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

/* ── Hypothesis System ────────────────────────────────────── */

export type HypothesisLevel = "continuous-a" | "continuous-b" | "groundbreaking";
export type ExperimentArchetype = "incremental" | "exploratory";

export interface Hypothesis {
  level: HypothesisLevel;
  statement: string;
  /** What would falsify this hypothesis */
  falsificationCriteria: string;
  /** Expected cost to test (agent's estimate) */
  estimatedCost: string;
}

export interface HypothesisSet {
  id: string;
  sessionId: string;
  timestamp: string;
  hypotheses: [Hypothesis, Hypothesis, Hypothesis];
  /** Which hypothesis the agent committed to */
  committedLevel: HypothesisLevel;
  /** Agent's rationale for commitment */
  commitmentRationale: string;
  /** What being wrong means for the committed hypothesis */
  costOfBeingWrong: string;
}

/* ── Oracle Surprise Tracking ────────────────────────────── */

export interface OracleSurpriseEntry {
  oracleId: string;
  timestamp: string;
  /** Agent's prior expectation BEFORE seeing the result */
  priorExpectation: string;
  /** Whether the result was surprising to the agent */
  wasSurprising: boolean;
  /** Brief explanation of what was expected vs. what was observed */
  surpriseExplanation?: string;
}

/* ── Kill Signal Log ─────────────────────────────────────── */

export interface KillSignalRecord {
  id: string;
  timestamp: string;
  /** Which hypothesis set was active */
  hypothesisSetId: string;
  /** What was being tried */
  description: string;
  /** Point at which it was abandoned */
  abandonmentPoint: string;
  /** Agent's stated reason */
  reason: string;
  /** Whether the first oracle query was adversarial or confirmatory */
  firstOracleType: "adversarial" | "confirmatory" | "none";
  /** Surprise rate at time of abandonment */
  surpriseRateAtAbandonment: number;
  /** Number of experiments completed for this hypothesis */
  experimentsCompleted: number;
}

/* ── Reflection Checkpoint ───────────────────────────────── */

export interface ReflectionCheckpoint {
  id: string;
  sessionId: string;
  timestamp: string;
  /** Experiment number at which this reflection occurred */
  afterExperimentNumber: number;
  /** What has been ruled out */
  ruledOut: string;
  /** What the current surprise rate implies */
  surpriseRateAnalysis: string;
  /** What a genuinely unexpected result would look like */
  unexpectedResultDescription: string;
  /** Current surprise rate at the time of reflection */
  currentSurpriseRate: number;
}

/* ── Agents ─────────────────────────────────────────────────── */

export type AgentStatus = "running" | "stopped" | "waiting_for_tool" | "blocked_on_permission";

export interface ForgeAgent {
  id: string;
  /** Auto-generated chess grandmaster name */
  name: string;
  createdAt: string;
  updatedAt: string;
  status: AgentStatus;
  /** Session this agent is currently working in (null if stopped) */
  currentSessionId: string | null;
  /** Ordered history of sessions this agent has worked on */
  sessionHistory: AgentSessionEntry[];
  /** Config the agent was started with */
  config: AgentConfig;
  /** Cumulative cost across all sessions */
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

export interface AgentSessionEntry {
  sessionId: string;
  sessionName: string;
  startedAt: string;
  endedAt: string | null;
  endReason?: "completed" | "abandoned" | "stopped";
  /** The decision that led to this session (autonomous mode) */
  decision?: AgentDecision;
}

export interface AgentConfig {
  players?: string[];   // If set, agent is locked to these players. If absent, autonomous.
  focus?: string;       // If set, agent is locked to this focus. If absent, autonomous.
  maxExperiments: number;
  seed: number;
  quick: boolean;
  /** Research bias: 0.0 = conservative (favor continuous), 1.0 = aggressive (favor groundbreaking). Default 0.5. */
  researchBias?: number;
}

/* ── Agent Decision (autonomous mode) ──────────────────────── */

export type AgentDecisionAction = "start_new" | "resume_session" | "join_session" | "review_paper" | "wait";

export interface AgentDecision {
  action: AgentDecisionAction;
  players: string[];
  focus: string;
  resumeSessionId?: string;
  /** Session ID to join (any existing session, not just the agent's own) */
  joinSessionId?: string;
  /** Paper ID to review (for review_paper action) */
  reviewPaperId?: string;
  reasoning: string;
}

/* ── Leaderboard (SQLite read-only types) ───────────────────── */

export interface LeaderboardEntry {
  agentId: string;
  agentName: string;
  rank: number;
  sessionsCount: number;
  avgAccuracyDelta: number;
  avgCplKlDelta: number;
  avgWeightedCompositeDelta: number;
  totalTimeSeconds: number;
  totalCostUsd: number;
}

export interface FeatureRequest {
  id: string;
  agentId: string;
  agentName: string;
  sessionId: string;
  timestamp: string;
  title: string;
  description: string;
  category: "repl" | "forge" | "harness" | "engine" | "other";
  status: "open" | "accepted" | "rejected" | "implemented";
  response: string | null;
}

/* ── Papers (re-exported from papers module) ─────────────── */

export type {
  Paper, PaperStatus, PaperReview, ReviewRecommendation, AdjudicationResult,
} from "../papers/paper-types";

/* ── Top-Level Forge State ────────────────────────────────── */

export interface ForgeState {
  version: 1 | 2;
  /** All research sessions */
  sessions: ForgeSession[];
  /** All agents */
  agents: ForgeAgent[];
  /** Currently active session ID (null if none) */
  activeSessionId: string | null;
  /** Last checkpoint timestamp */
  lastCheckpoint: string;
}

/**
 * Dashboard-relevant subset of packages/forge/src/state/types.ts.
 * BotConfig and Metrics replaced with `unknown` to avoid Node-only engine deps.
 */

export type SessionStatus = "active" | "paused" | "completed" | "abandoned";

export interface ForgeState {
  version: 1 | 2;
  sessions: ForgeSession[];
  agents: ForgeAgent[];
  activeSessionId: string | null;
  lastCheckpoint: string;
}

export interface ForgeSession {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  agentId: string | null;
  worktreeBranch: string;
  focus: string;
  players: string[];
  baseline: BaselineSnapshot | null;
  experiments: ExperimentRecord[];
  bestResult: MaiaMetrics | null;
  bestExperimentId: string | null;
  activeChanges: CodeChange[];
  conversationHistory: unknown[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  oracleConsultations: OracleRecord[];
  interactions?: InteractionRecord[];
  hypothesisSets?: HypothesisSet[];
  oracleSurprises?: OracleSurpriseEntry[];
  killSignals?: KillSignalRecord[];
  reflections?: ReflectionCheckpoint[];
}

/* ── Agents ─────────────────────────────────────────────────── */

export type AgentStatus = "running" | "stopped";

export interface ForgeAgent {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: AgentStatus;
  currentSessionId: string | null;
  sessionHistory: AgentSessionEntry[];
  config: AgentConfig;
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
}

export interface AgentConfig {
  players: string[];
  focus: string;
  maxExperiments: number;
  seed: number;
  quick: boolean;
}

export interface AgentSummary {
  id: string;
  name: string;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
  currentSessionId: string | null;
  currentSessionName: string | null;
  sessionCount: number;
  totalCostUsd: number;
  config: AgentConfig;
  isRunning: boolean;
  rank: number | null;
  avgWeightedCompositeDelta: number;
  avgAccuracyDelta: number;
  totalTimeSeconds: number;
}

/* ── Leaderboard ────────────────────────────────────────────── */

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

/* ── Metrics ────────────────────────────────────────────────── */

export interface BaselineSnapshot {
  timestamp: string;
  config: unknown;
  playerMetrics: PlayerMetricSnapshot[];
  aggregate: MaiaMetrics;
  splitHashes: Record<string, string>;
}

export interface PlayerMetricSnapshot {
  username: string;
  elo: number;
  metrics: MaiaMetrics;
  positionsEvaluated: number;
}

export interface MaiaMetrics {
  moveAccuracy: number;
  moveAccuracyByPhase: PhaseValues;
  cplKLDivergence: number;
  cplKSStatistic: number;
  cplKSPValue: number;
  cplByPhase: Record<string, { klDivergence: number; ksStatistic: number }>;
  blunderRateDelta: PhaseValues;
  mistakeRateDelta: PhaseValues;
  compositeScore: number;
  rawMetrics: unknown;
  positionsEvaluated: number;
}

export interface PhaseValues {
  opening: number;
  middlegame: number;
  endgame: number;
  overall: number;
}

export interface SignificanceResult {
  metricName: string;
  baseline: number;
  experiment: number;
  delta: number;
  ci95: [number, number];
  pValue: number;
  effectSize: number;
  significant: boolean;
}

export interface ExperimentRecord {
  id: string;
  sessionId: string;
  number: number;
  timestamp: string;
  hypothesis: string;
  category: "algorithm" | "parameter" | "architecture" | "data";
  codeChanges: CodeChange[];
  configChanges: ConfigChangeRecord[];
  players: string[];
  positionsEvaluated: number;
  evaluationDurationMs: number;
  result: MaiaMetrics;
  delta: MaiaMetricsDelta;
  significance: SignificanceResult[];
  conclusion: "confirmed" | "refuted" | "partial" | "inconclusive";
  notes: string;
  nextSteps: string[];
  oracleQueryId?: string;
  archetype?: ExperimentArchetype;
  hypothesisSetId?: string;
  hypothesisLevel?: HypothesisLevel;
}

export interface MaiaMetricsDelta {
  moveAccuracy: number;
  cplKLDivergence: number;
  blunderRateDelta: number;
  compositeScore: number;
}

export interface CodeChange {
  id: string;
  timestamp: string;
  file: string;
  description: string;
  hypothesis: string;
  diff: string;
  type: "code" | "config";
}

export interface ConfigChangeRecord {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  description: string;
}

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
  queryType?: "adversarial" | "confirmatory" | "exploratory";
}

/* ── Hypothesis System ────────────────────────────────────── */

export type HypothesisLevel = "continuous-a" | "continuous-b" | "groundbreaking";
export type ExperimentArchetype = "incremental" | "exploratory";

export interface Hypothesis {
  level: HypothesisLevel;
  statement: string;
  falsificationCriteria: string;
  estimatedCost: string;
}

export interface HypothesisSet {
  id: string;
  sessionId: string;
  timestamp: string;
  hypotheses: [Hypothesis, Hypothesis, Hypothesis];
  committedLevel: HypothesisLevel;
  commitmentRationale: string;
  costOfBeingWrong: string;
}

export interface OracleSurpriseEntry {
  oracleId: string;
  timestamp: string;
  priorExpectation: string;
  wasSurprising: boolean;
  surpriseExplanation?: string;
}

export interface KillSignalRecord {
  id: string;
  timestamp: string;
  hypothesisSetId: string;
  description: string;
  abandonmentPoint: string;
  reason: string;
  firstOracleType: "adversarial" | "confirmatory" | "none";
  surpriseRateAtAbandonment: number;
  experimentsCompleted: number;
}

export interface ReflectionCheckpoint {
  id: string;
  sessionId: string;
  timestamp: string;
  afterExperimentNumber: number;
  ruledOut: string;
  surpriseRateAnalysis: string;
  unexpectedResultDescription: string;
  currentSurpriseRate: number;
}

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

export interface KnowledgeTopic {
  id: string;
  topic: string;
  relevance: string[];
  updated: string;
  content: string;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: "experiment" | "oracle" | "code-change" | "note" | "knowledge-update" | "session-status" | "hypothesis" | "kill-signal" | "reflection";
  title: string;
  detail?: string;
  artifactId?: string;
  artifactType?: string;
  consoleTimestamp?: string;
}

export interface SessionSummary {
  id: string;
  name: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  focus: string;
  players: string[];
  experimentCount: number;
  oracleCount: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  bestCompositeScore: number | null;
  worktreeBranch: string;
  agentId: string | null;
  agentName: string | null;
  /** True when the agent process is actually running (PID alive) */
  isRunning: boolean;
}

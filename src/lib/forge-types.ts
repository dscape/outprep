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
  /** The decision that led to this session (autonomous mode) */
  decision?: AgentDecision;
}

export interface AgentConfig {
  players?: string[];   // If set, agent is locked to these players. If absent, autonomous.
  focus?: string;       // If set, agent is locked to this focus. If absent, autonomous.
  maxExperiments: number;
  seed: number;
  quick: boolean;
  /** Research bias: 0.0 = conservative, 1.0 = aggressive. Default 0.5. */
  researchBias?: number;
}

/* ── Agent Decision (autonomous mode) ──────────────────────── */

export type AgentDecisionAction = "start_new" | "resume_session" | "join_session" | "wait";

export interface AgentDecision {
  action: AgentDecisionAction;
  players: string[];
  focus: string;
  resumeSessionId?: string;
  /** Session ID to join (any existing session, not just the agent's own) */
  joinSessionId?: string;
  reasoning: string;
}

export type AgentDisplayStatus = "running" | "stopped" | "waiting_for_tool" | "blocked_on_permission" | "dead";

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
  /** Rich process status: running, stopped, waiting_for_tool, blocked_on_permission, dead */
  runStatus: AgentDisplayStatus;
  /** Detail for the status (e.g. tool name or permission type) */
  runStatusDetail?: string;
  rank: number | null;
  avgWeightedCompositeDelta: number;
  avgAccuracyDelta: number;
  totalTimeSeconds: number;
}

export interface AgentDetail extends AgentSummary {
  sessionHistory: AgentSessionEntry[];
  totalInputTokens: number;
  totalOutputTokens: number;
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

/* ── Tool Jobs & Tasks ─────────────────────────────────────── */

export type ToolJobStatus = "pending" | "running" | "completed" | "failed" | "archived";

export interface ToolJob {
  id: string;
  session_id: string;
  agent_id: string | null;
  agent_name: string | null;
  tool_name: string;
  status: ToolJobStatus;
  input: string | null;
  output: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  blocking: number;
  archived_at: string | null;
  retry_count: number;
}

export interface PermissionRequestRow {
  id: string;
  session_id: string;
  agent_id: string | null;
  agent_name: string | null;
  requested_at: string;
  permission_type: string | null;
  details: string | null;
  status: string;
  responded_at: string | null;
  response_by: string | null;
}

export interface TasksResponse {
  toolJobs: ToolJob[];
  permissionRequests: PermissionRequestRow[];
  counts: {
    pendingToolJobs: number;
    runningToolJobs: number;
    pendingPermissions: number;
  };
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

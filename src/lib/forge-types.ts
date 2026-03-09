/**
 * Dashboard-relevant subset of packages/forge/src/state/types.ts.
 * BotConfig and Metrics replaced with `unknown` to avoid Node-only engine deps.
 */

export type SessionStatus = "active" | "paused" | "completed" | "abandoned";

export interface ForgeState {
  version: 1;
  sessions: ForgeSession[];
  activeSessionId: string | null;
  lastCheckpoint: string;
}

export interface ForgeSession {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
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
}

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
}

export interface KnowledgeTopic {
  id: string;
  topic: string;
  relevance: string[];
  updated: string;
  content: string;
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
}

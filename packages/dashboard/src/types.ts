/**
 * Dashboard types — mirrors the harness output schemas.
 * No dependency on @outprep/engine; reads raw JSON.
 */

export type GamePhase = "opening" | "middlegame" | "endgame";
export type MoveSource = "book" | "engine";

export interface PhaseMetrics {
  totalPositions: number;
  matchRate: number;
  topNRate: number;
  bookCoverage: number;
  avgActualCPL: number;
  avgBotCPL: number;
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

export interface VersionInfo {
  gitCommit: string;
  gitDirty: boolean;
  engineVersion: string;
  harnessVersion: string;
  stockfishVersion: string;
}

export interface TestResult {
  datasetName: string;
  username: string;
  timestamp: string;
  seed: number;
  label: string;
  elo: number;
  configOverrides: Record<string, unknown>;
  /** Optional — present in results from harness v0.1.0+ with version tracking */
  version?: VersionInfo;
  /** Optional — full resolved BotConfig snapshot */
  resolvedConfig?: Record<string, unknown>;
  metrics: Metrics;
  positions: PositionResult[];
}

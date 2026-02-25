/**
 * Public API for programmatic use by @outprep/tuner and other packages.
 *
 * The CLI (`cli.ts`) is the main entry point for human use.
 * This barrel export lets other packages call the harness as a library.
 */

export { runAccuracyTest } from "./runner";
export type { RunCallbacks } from "./runner";
export { fetchLichessGames, fetchLichessUser } from "./lichess-fetch";
export { computeMetrics } from "./metrics";
export { NodeStockfishAdapter } from "./node-stockfish";
export { captureVersionInfo, resolveFullConfig } from "./version";
export type {
  Dataset,
  RunConfig,
  TestResult,
  PositionResult,
  Metrics,
  PhaseMetrics,
} from "./types";
export type { LichessGame, LichessUser } from "./lichess-types";

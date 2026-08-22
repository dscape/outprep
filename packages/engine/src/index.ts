// --- Core modules ---
export { BotController } from "./bot-controller";
export {
  detectPhase,
  detectPhaseFromBoard,
  countMinorMajorPieces,
  materialScore,
} from "./phase-detector";
export { buildErrorProfileFromEvals } from "./error-profile";
export {
  buildOpeningTrie,
  mergeOpeningTries,
  lookupTrie,
  sampleTrieMove,
} from "./opening-trie";
export {
  eloToSkillLevel,
  dynamicSkillLevel,
  boltzmannSelect,
  temperatureFromSkill,
} from "./move-selector";
export {
  classifyMove,
  applyStyleBonus,
  analyzeStyleFromRecords,
  type MoveType,
} from "./move-style";
export { complexityDepthAdjust } from "./complexity";
export {
  estimateHumanThinkTime,
  type HumanThinkEstimate,
  type ThinkDifficulty,
} from "./human-think-time";

// --- Utilities ---
export { matchesPlayerName, crc32 } from "./player-name";
export {
  maiaMoveIndex,
  mirrorMove,
  preprocessMaiaPosition,
  probabilitiesForLegalMoves,
  sampleMaiaMove,
} from "./maia-tensor";
export type { MaiaInput, MaiaLegalMove } from "./maia-tensor";

// --- Configuration ---
export { DEFAULT_CONFIG, mergeConfig } from "./config";

// --- Types ---
export type {
  BotConfig,
  ChessEngine,
  CandidateMove,
  GamePhase,
  ErrorProfile,
  PhaseErrors,
  GameEvalData,
  GameRecord,
  OpeningTrie,
  TrieNode,
  TrieMove,
  BotMoveResult,
  MoveSource,
  MovePolicy,
  MovePolicyResult,
  PolicyCandidate,
  StyleMetrics,
} from "./types";

// --- Factory ---

import type {
  ChessEngine,
  ErrorProfile,
  OpeningTrie,
  BotConfig,
  StyleMetrics,
  MovePolicy,
} from "./types";
import { BotController } from "./bot-controller";

/**
 * Create a bot controller — the primary entry point for consumers.
 *
 * The harness calls this with different configs and elos.
 * The app calls this once per practice session.
 */
export function createBot(
  engine: ChessEngine,
  options: {
    elo: number;
    errorProfile: ErrorProfile | null;
    openingTrie: OpeningTrie | null;
    botColor: "white" | "black";
    config?: Partial<BotConfig>;
    styleMetrics?: StyleMetrics | null;
    movePolicy?: MovePolicy | null;
    onPolicyFailure?: (error: Error) => void;
  }
): BotController {
  return new BotController({ engine, ...options });
}

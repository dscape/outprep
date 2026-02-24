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
  lookupTrie,
  sampleTrieMove,
} from "./opening-trie";
export {
  eloToSkillLevel,
  dynamicSkillLevel,
  boltzmannSelect,
  temperatureFromSkill,
} from "./move-selector";

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
} from "./types";

// --- Factory ---

import type {
  ChessEngine,
  ErrorProfile,
  OpeningTrie,
  BotConfig,
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
  }
): BotController {
  return new BotController({ engine, ...options });
}

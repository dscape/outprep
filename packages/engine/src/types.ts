/* ── Game Phase ────────────────────────────────────────────── */

export type GamePhase = "opening" | "middlegame" | "endgame";

/* ── Chess Engine Abstraction ─────────────────────────────── */

/**
 * Platform-agnostic chess engine interface.
 *
 * The Outprep app provides a browser WASM adapter;
 * the test harness provides a Node.js adapter.
 * Both implement this interface.
 */
export interface ChessEngine {
  /** Analyze a position and return the top N candidate moves.
   *  @param skillLevel — optional Stockfish Skill Level (0-20).
   *    When provided, sets `setoption name Skill Level value X` before the
   *    search so the engine deliberately considers weaker moves.
   *    When omitted, resets to 20 (full strength) to prevent stale state.
   */
  evaluateMultiPV(
    fen: string,
    depth: number,
    numPV: number,
    skillLevel?: number
  ): Promise<CandidateMove[]>;

  /** Analyze a position and return the single best move. */
  evaluate(fen: string, depth: number): Promise<CandidateMove>;

  /** Clean up resources (workers, child processes, etc.) */
  dispose(): void;
}

/**
 * A candidate move returned by MultiPV analysis.
 */
export interface CandidateMove {
  /** UCI notation, e.g. "e2e4" */
  uci: string;
  /** SAN notation, e.g. "e4" (optional — not all adapters provide this) */
  san?: string;
  /** Centipawns from side-to-move's perspective */
  score: number;
  /** Search depth reached */
  depth: number;
  /** Principal variation as space-separated UCI moves */
  pv: string;
}

/* ── Error Profile ────────────────────────────────────────── */

export interface PhaseErrors {
  totalMoves: number;
  mistakes: number; // 100-300cp loss (configurable via BotConfig)
  blunders: number; // 300+cp loss (configurable via BotConfig)
  avgCPL: number;
  errorRate: number; // (mistakes + blunders) / totalMoves
  blunderRate: number; // blunders / totalMoves
}

export interface ErrorProfile {
  opening: PhaseErrors;
  middlegame: PhaseErrors;
  endgame: PhaseErrors;
  overall: PhaseErrors;
  gamesAnalyzed: number;
}

/* ── Generic Game Data (platform-agnostic) ────────────────── */

/**
 * Generic eval data for building error profiles.
 * Source-agnostic: works with Lichess annotations, local Stockfish, etc.
 */
export interface GameEvalData {
  /** Space-separated SAN moves */
  moves: string;
  playerColor: "white" | "black";
  /** evals[i] = centipawns from white's perspective after ply i. NaN = not evaluated. */
  evals: number[];
}

/**
 * Generic game record for building opening tries.
 * Source-agnostic: the app maps LichessGame → GameRecord.
 */
export interface GameRecord {
  /** Space-separated SAN moves */
  moves: string;
  /** Which color the profiled player was */
  playerColor: "white" | "black";
  /** Game result (from white's perspective) */
  result?: "white" | "black" | "draw";
}

/* ── Opening Trie ─────────────────────────────────────────── */

export interface TrieNode {
  moves: TrieMove[];
  totalGames: number;
}

export interface TrieMove {
  uci: string;
  san: string;
  count: number;
  /** Win rate from the profiled player's perspective (0-1) */
  winRate: number;
}

export interface OpeningTrie {
  [fenKey: string]: TrieNode;
}

/* ── Style Metrics ───────────────────────────────────────── */

/**
 * Player style profile — scores from 0-100 indicating play tendencies.
 * Computed from game patterns (quick wins, sacrifices, game length, etc.).
 * Used to bias move selection toward the player's natural style.
 */
export interface StyleMetrics {
  /** Preference for captures, sacrifices, and short decisive games */
  aggression: number;
  /** Preference for sharp tactical positions and combinations */
  tactical: number;
  /** Preference for quiet, strategic play and long games */
  positional: number;
  /** Ability to convert advantages in long endgames */
  endgame: number;
  /** Number of games analyzed (for confidence dampening) */
  sampleSize: number;
}

/* ── Bot Output ───────────────────────────────────────────── */

export type MoveSource = "book" | "engine";

export interface BotMoveResult {
  uci: string;
  san?: string;
  source: MoveSource;
  thinkTimeMs: number;
  phase: GamePhase;
  dynamicSkill: number;
  /** MultiPV candidates from engine evaluation (absent for book moves). */
  candidates?: CandidateMove[];
}

/* ── Bot Configuration ────────────────────────────────────── */

export interface BotConfig {
  /** Elo range for skill-level linear mapping */
  elo: { min: number; max: number };

  /** Stockfish UCI Skill Level range */
  skill: { min: number; max: number };

  /** Material-based phase detection thresholds (non-pawn, non-king piece count) */
  phase: {
    /** Phase is "opening" when piece count is ABOVE this value */
    openingAbove: number;
    /** Phase is "endgame" when piece count is AT OR BELOW this value */
    endgameAtOrBelow: number;
  };

  /** Centipawn loss thresholds for error classification */
  error: {
    /** Minimum cp loss for "mistake" classification */
    mistake: number;
    /** Minimum cp loss for "blunder" classification */
    blunder: number;
  };

  /** Dynamic skill adjustment per game phase */
  dynamicSkill: {
    /** Log2 coefficient: adjustment = round(scale * log2(ratio)) */
    scale: number;
    /** Skill bonus when phase error rate is near zero */
    perfectPhaseBonus: number;
    /** Minimum total moves in overall profile for adjustment to apply */
    minOverallMoves: number;
    /** Minimum total moves in phase for adjustment to apply */
    minPhaseMoves: number;
  };

  /** Boltzmann (softmax) move selection parameters */
  boltzmann: {
    /** Number of MultiPV candidates to request */
    multiPvCount: number;
    /** Minimum temperature (prevents deterministic play at high skill) */
    temperatureFloor: number;
    /** Legacy linear scale — superseded by temperatureBySkill table */
    temperatureScale: number;
    /**
     * Per-band temperature table (same pattern as depthBySkill).
     * Array of [maxSkill, temperature] pairs, checked in order.
     * Gives the tuner independent control over temperature at each skill tier.
     */
    temperatureBySkill: [number, number][];
  };

  /**
   * Search depth by skill level.
   * Array of [maxSkill, depth] pairs, checked in order.
   * E.g. [[3,5],[6,7]] means skill 0-3 → depth 5, skill 4-6 → depth 7.
   */
  depthBySkill: [number, number][];

  /** Opening trie parameters */
  trie: {
    /** Maximum ply depth for trie building (40 plies = 20 full moves) */
    maxPly: number;
    /** Minimum games to include a position in the trie */
    minGames: number;
    /**
     * Win-rate bias for trie move sampling (0 = count-only, 1 = strong win-rate influence).
     * Blends frequency and success: weight = count * (1 + winBias * (winRate - 0.5))
     * At 0: pure frequency sampling (original behavior).
     * At 1: winning moves get up to 50% weight boost, losing moves 50% penalty.
     */
    winBias: number;
  };

  /** Player style bias — nudges move selection toward the player's style */
  moveStyle: {
    /** Overall strength of style bias (0 = off, 1 = full) */
    influence: number;
    /** Max centipawn bonus for captures (aggression axis) */
    captureBonus: number;
    /** Max centipawn bonus for checks (tactical axis) */
    checkBonus: number;
    /** Max centipawn bonus for quiet moves (positional axis) */
    quietBonus: number;
    /** Skill damping: influence fades as skill increases (0 = flat, 1 = zero at max skill) */
    skillDamping: number;
  };

  /** Position complexity → depth adjustment */
  complexityDepth: {
    /** Enable complexity-based depth adjustment */
    enabled: boolean;
    /** Number of legal captures at or above which position is "tactical" */
    captureThreshold: number;
    /** Number of legal captures at or below which position is "quiet" */
    quietThreshold: number;
    /** Depth bonus for tactical positions (e.g. +2) */
    tacticalBonus: number;
    /** Depth reduction for quiet positions (e.g. 1) */
    quietReduction: number;
    /** Absolute minimum depth (never go below this) */
    minDepth: number;
  };

  /** Think time simulation */
  thinkTime: {
    enabled: boolean;
    baseByPhase: { opening: number; middlegame: number; endgame: number };
    bookMoveRange: [number, number];
    /** Max bonus ms when top 2 candidates are close */
    difficultyBonusMax: number;
    /** cp gap threshold for "difficult" decisions */
    closeEvalThreshold: number;
    /** ± random jitter in ms */
    jitter: number;
    /** Floor for think time in ms */
    minimum: number;
  };
}

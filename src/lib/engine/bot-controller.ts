import { StockfishEngine } from "../stockfish-worker";
import { ErrorProfile } from "../types";
import { detectPhase, GamePhase } from "./phase-detector";
import { OpeningTrie, lookupTrie, sampleTrieMove } from "./opening-trie";
import {
  CandidateMove,
  eloToSkillLevel,
  dynamicSkillLevel,
  boltzmannSelect,
} from "./move-selector";

/* ── Public types ──────────────────────────────────────────── */

export type MoveSource = "book" | "engine";

export interface BotMoveResult {
  uci: string;
  san?: string;
  source: MoveSource;
  thinkTimeMs: number;
  phase: GamePhase;
  dynamicSkill: number;
}

export interface BotControllerConfig {
  engine: StockfishEngine;
  fideEstimate: number;
  errorProfile: ErrorProfile | null;
  openingTrie: OpeningTrie | null;
  botColor: "white" | "black";
}

/* ── Think time parameters ─────────────────────────────────── */

const THINK_BASE: Record<GamePhase, number> = {
  opening: 1500,
  middlegame: 3000,
  endgame: 2500,
};

const THINK_BOOK_MIN = 500;
const THINK_BOOK_MAX = 2000;
const THINK_DIFFICULTY_BONUS_MAX = 2000; // added when top-2 candidates are close
const THINK_JITTER = 1000; // ± jitter
const CLOSE_EVAL_THRESHOLD = 20; // cp — if top two are within this, it's a "hard" decision

/* ── UCI validation ────────────────────────────────────────── */

/** Check that a string looks like a valid UCI move (e.g. "e2e4", "e7e8q") */
function isValidUCI(uci: string): boolean {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci);
}

/* ── Search depth by skill ─────────────────────────────────── */

/**
 * Map dynamic skill level (0-20) to Stockfish search depth.
 * Higher skill → deeper search, but not directly tied to FIDE rating.
 */
function depthForSkill(skill: number): number {
  if (skill <= 3) return 5;
  if (skill <= 6) return 7;
  if (skill <= 9) return 10;
  if (skill <= 12) return 12;
  if (skill <= 15) return 15;
  if (skill <= 17) return 17;
  if (skill <= 19) return 20;
  return 22;
}

/* ── Bot Controller ────────────────────────────────────────── */

export class BotController {
  private engine: StockfishEngine;
  private baseSkill: number;
  private errorProfile: ErrorProfile | null;
  private openingTrie: OpeningTrie | null;
  private botColor: "white" | "black";

  constructor(config: BotControllerConfig) {
    this.engine = config.engine;
    this.baseSkill = eloToSkillLevel(config.fideEstimate);
    this.errorProfile = config.errorProfile;
    this.openingTrie = config.openingTrie;
    this.botColor = config.botColor;
  }

  /**
   * Get the bot's next move.
   *
   * Logic:
   * 1. Look up FEN in opening trie → if found, sample weighted move, return as 'book'
   * 2. If not in trie: detect phase, look up error profile for that phase
   * 3. Calculate dynamic skill level
   * 4. Run Stockfish MultiPV 4
   * 5. Boltzmann-select from candidates
   * 6. Calculate think time
   * 7. Return move
   */
  async getMove(fen: string): Promise<BotMoveResult> {
    // 1. Opening trie lookup
    if (this.openingTrie) {
      const node = lookupTrie(this.openingTrie, fen);
      if (node) {
        const bookMove = sampleTrieMove(node);
        if (bookMove && isValidUCI(bookMove.uci)) {
          return {
            uci: bookMove.uci,
            san: bookMove.san,
            source: "book",
            thinkTimeMs: computeBookThinkTime(),
            phase: detectPhase(fen),
            dynamicSkill: this.baseSkill,
          };
        }
      }
    }

    // 2. Detect phase
    const phase = detectPhase(fen);

    // 3. Calculate dynamic skill level
    const skill =
      this.errorProfile
        ? dynamicSkillLevel(this.baseSkill, this.errorProfile, phase)
        : this.baseSkill;

    // 4. Run Stockfish MultiPV 4
    const depth = depthForSkill(skill);
    const multiPVResults = await this.engine.evaluateMultiPV(fen, depth, 4);

    // Filter to valid UCI moves only
    const validResults = multiPVResults.filter((r) => isValidUCI(r.bestMove));

    if (validResults.length === 0) {
      // Fallback: single best move
      const fallback = await this.engine.evaluate(fen, depth);
      return {
        uci: fallback.bestMove,
        source: "engine",
        thinkTimeMs: computeEngineThinkTime(phase, []),
        phase,
        dynamicSkill: skill,
      };
    }

    // 5. Boltzmann-select from candidates
    const candidates: CandidateMove[] = validResults.map((r) => ({
      uci: r.bestMove,
      score: r.eval,
      depth: r.depth,
      pv: r.pv,
    }));

    const selected = boltzmannSelect(candidates, skill);

    // 6. Calculate think time
    const thinkTimeMs = computeEngineThinkTime(phase, candidates);

    return {
      uci: selected.uci,
      source: "engine",
      thinkTimeMs,
      phase,
      dynamicSkill: skill,
    };
  }
}

/* ── Think time helpers ────────────────────────────────────── */

function computeBookThinkTime(): number {
  return THINK_BOOK_MIN + Math.random() * (THINK_BOOK_MAX - THINK_BOOK_MIN);
}

function computeEngineThinkTime(
  phase: GamePhase,
  candidates: CandidateMove[]
): number {
  let time = THINK_BASE[phase];

  // Difficulty bonus: if top two candidates are close, add thinking time
  if (candidates.length >= 2) {
    const scoreDiff = Math.abs(candidates[0].score - candidates[1].score);
    if (scoreDiff <= CLOSE_EVAL_THRESHOLD) {
      // Closer candidates → more thinking time
      const difficultyFactor = 1 - scoreDiff / CLOSE_EVAL_THRESHOLD;
      time += difficultyFactor * THINK_DIFFICULTY_BONUS_MAX;
    }
  }

  // Random jitter ± THINK_JITTER
  time += (Math.random() * 2 - 1) * THINK_JITTER;

  return Math.max(300, Math.round(time));
}

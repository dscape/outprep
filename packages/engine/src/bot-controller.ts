import type {
  ChessEngine,
  CandidateMove,
  ErrorProfile,
  OpeningTrie,
  BotMoveResult,
  GamePhase,
  BotConfig,
  StyleMetrics,
} from "./types";
import { DEFAULT_CONFIG, mergeConfig } from "./config";
import { detectPhase } from "./phase-detector";
import { lookupTrie, sampleTrieMove } from "./opening-trie";
import {
  eloToSkillLevel,
  dynamicSkillLevel,
  boltzmannSelect,
} from "./move-selector";
import { applyStyleBonus } from "./move-style";
import { complexityDepthAdjust } from "./complexity";

/* ── UCI validation ────────────────────────────────────────── */

/** Check that a string looks like a valid UCI move (e.g. "e2e4", "e7e8q") */
function isValidUCI(uci: string): boolean {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci);
}

/* ── Search depth by skill ─────────────────────────────────── */

/**
 * Map dynamic skill level to Stockfish search depth.
 * Uses the depthBySkill table from config.
 */
function depthForSkill(skill: number, config: BotConfig): number {
  for (const [maxSkill, depth] of config.depthBySkill) {
    if (skill <= maxSkill) return depth;
  }
  // Fallback: last entry's depth (highest skill)
  const last = config.depthBySkill[config.depthBySkill.length - 1];
  return last ? last[1] : 22;
}

/* ── Bot Controller ────────────────────────────────────────── */

export class BotController {
  private engine: ChessEngine;
  private baseSkill: number;
  private errorProfile: ErrorProfile | null;
  private openingTrie: OpeningTrie | null;
  private styleMetrics: StyleMetrics | null;
  private botColor: "white" | "black";
  private config: BotConfig;

  constructor(options: {
    engine: ChessEngine;
    elo: number;
    errorProfile: ErrorProfile | null;
    openingTrie: OpeningTrie | null;
    botColor: "white" | "black";
    config?: Partial<BotConfig>;
    styleMetrics?: StyleMetrics | null;
  }) {
    this.config = mergeConfig(DEFAULT_CONFIG, options.config);
    this.engine = options.engine;
    this.baseSkill = eloToSkillLevel(options.elo, this.config);
    this.errorProfile = options.errorProfile;
    this.openingTrie = options.openingTrie;
    this.styleMetrics = options.styleMetrics ?? null;
    this.botColor = options.botColor;
  }

  /**
   * Get the bot's next move.
   *
   * Logic:
   * 1. Look up FEN in opening trie → if found, sample weighted move, return as 'book'
   * 2. If not in trie: detect phase, look up error profile for that phase
   * 3. Calculate dynamic skill level
   * 4. Run engine MultiPV
   * 5. Boltzmann-select from candidates
   * 6. Calculate think time
   * 7. Return move
   */
  async getMove(fen: string): Promise<BotMoveResult> {
    // 1. Opening trie lookup
    if (this.openingTrie) {
      const node = lookupTrie(this.openingTrie, fen);
      if (node) {
        const bookMove = sampleTrieMove(node, this.config.trie.winBias);
        if (bookMove && isValidUCI(bookMove.uci)) {
          return {
            uci: bookMove.uci,
            san: bookMove.san,
            source: "book",
            thinkTimeMs: this.computeBookThinkTime(),
            phase: detectPhase(fen, this.config),
            dynamicSkill: this.baseSkill,
          };
        }
      }
    }

    // 2. Detect phase
    const phase = detectPhase(fen, this.config);

    // 3. Calculate dynamic skill level
    const skill = this.errorProfile
      ? dynamicSkillLevel(this.baseSkill, this.errorProfile, phase, this.config)
      : this.baseSkill;

    // 4. Run engine MultiPV (pass skill level so Stockfish weakens internally)
    const baseDepth = depthForSkill(skill, this.config);
    const depthAdj = complexityDepthAdjust(fen, this.config.complexityDepth);
    const depth = Math.max(this.config.complexityDepth.minDepth, baseDepth + depthAdj);
    const multiPVResults = await this.engine.evaluateMultiPV(
      fen,
      depth,
      this.config.boltzmann.multiPvCount,
      skill
    );

    // Filter to valid UCI moves only
    const validResults = multiPVResults.filter((r) => isValidUCI(r.uci));

    if (validResults.length === 0) {
      // Fallback: single best move
      const fallback = await this.engine.evaluate(fen, depth);
      return {
        uci: fallback.uci,
        source: "engine",
        thinkTimeMs: this.computeEngineThinkTime(phase, []),
        phase,
        dynamicSkill: skill,
      };
    }

    // 5. Apply style bonus (nudge scores toward player's style)
    const styledResults = this.styleMetrics
      ? applyStyleBonus(validResults, fen, this.styleMetrics, this.config, skill)
      : validResults;

    // 6. Boltzmann-select from styled candidates
    const selected = boltzmannSelect(styledResults, skill, this.config);

    // 7. Calculate think time
    const thinkTimeMs = this.computeEngineThinkTime(phase, styledResults);

    return {
      uci: selected.uci,
      san: selected.san,
      source: "engine",
      thinkTimeMs,
      phase,
      dynamicSkill: skill,
      candidates: styledResults,
    };
  }

  /* ── Think time helpers ────────────────────────────────── */

  private computeBookThinkTime(): number {
    if (!this.config.thinkTime.enabled) return 0;
    const [min, max] = this.config.thinkTime.bookMoveRange;
    return min + Math.random() * (max - min);
  }

  private computeEngineThinkTime(
    phase: GamePhase,
    candidates: CandidateMove[]
  ): number {
    if (!this.config.thinkTime.enabled) return 0;

    const tt = this.config.thinkTime;
    let time = tt.baseByPhase[phase];

    // Difficulty bonus: if top two candidates are close, add thinking time
    if (candidates.length >= 2) {
      const scoreDiff = Math.abs(candidates[0].score - candidates[1].score);
      if (scoreDiff <= tt.closeEvalThreshold) {
        const difficultyFactor = 1 - scoreDiff / tt.closeEvalThreshold;
        time += difficultyFactor * tt.difficultyBonusMax;
      }
    }

    // Random jitter
    time += (Math.random() * 2 - 1) * tt.jitter;

    return Math.max(tt.minimum, Math.round(time));
  }
}

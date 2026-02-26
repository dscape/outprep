/**
 * Core test runner — replays games position-by-position and compares
 * the bot's move choices against the actual player's moves.
 */

import { Chess } from "chess.js";
import {
  createBot,
  buildErrorProfileFromEvals,
  buildOpeningTrie,
  analyzeStyleFromRecords,
  detectPhase,
  type ChessEngine,
  type CandidateMove,
  type ErrorProfile,
  type OpeningTrie,
  type GameRecord,
  type GameEvalData,
  type GamePhase,
  type StyleMetrics,
  type BotConfig,
} from "@outprep/engine";
import { patchMathRandom } from "./seeded-random";
import { lichessGameToGameRecord, lichessGameToEvalData } from "./lichess-adapters";
import { computeMetrics } from "./metrics";
import { captureVersionInfo, resolveFullConfig } from "./version";
import type { Dataset, RunConfig, TestResult, PositionResult } from "./types";
import type { LichessGame } from "./lichess-types";

export interface RunCallbacks {
  onProgress?: (evaluated: number, total: number) => void;
}

/* ── Phase-balanced position sampling ─────────────────────── */

interface CandidatePosition {
  gameIndex: number;
  ply: number;
  phase: GamePhase;
}

/**
 * Pre-scan all games and collect candidate positions with their phases.
 * This is lightweight — only chess.js parsing and piece counting, no engine.
 */
function collectCandidatePositions(
  games: LichessGame[],
  username: string,
  config: BotConfig
): CandidatePosition[] {
  const candidates: CandidatePosition[] = [];

  let gameIndex = 0;
  for (const game of games) {
    if (!game.moves || game.variant !== "standard") {
      gameIndex++;
      continue;
    }

    const isWhite =
      game.players.white?.user?.id?.toLowerCase() === username.toLowerCase();
    const chess = new Chess();
    const moves = game.moves.split(" ");

    for (let ply = 0; ply < moves.length; ply++) {
      const isWhiteMove = ply % 2 === 0;
      const isPlayerMove =
        (isWhite && isWhiteMove) || (!isWhite && !isWhiteMove);

      if (isPlayerMove) {
        const fen = chess.fen();
        candidates.push({
          gameIndex,
          ply,
          phase: detectPhase(fen, config),
        });
      }

      try {
        chess.move(moves[ply]);
      } catch {
        break;
      }
    }

    gameIndex++;
  }

  return candidates;
}

/**
 * Sample positions with phase balancing.
 *
 * Target distribution: 40% opening, 40% middlegame, 20% endgame.
 * If a phase has fewer positions than its quota, take all of them
 * and redistribute the remaining slots to other phases.
 *
 * Uses a seeded shuffle to ensure reproducibility.
 */
function sampleWithPhaseBalance(
  candidates: CandidatePosition[],
  maxPositions: number,
  seed: number
): Set<string> {
  // Group by phase
  const byPhase: Record<GamePhase, CandidatePosition[]> = {
    opening: [],
    middlegame: [],
    endgame: [],
  };
  for (const c of candidates) {
    byPhase[c.phase].push(c);
  }

  // Target quotas (proportional, but respect availability)
  const targets: Record<GamePhase, number> = {
    opening: Math.round(maxPositions * 0.40),
    middlegame: Math.round(maxPositions * 0.40),
    endgame: Math.round(maxPositions * 0.20),
  };

  // Phase priority for redistribution: middlegame > endgame > opening
  const phases: GamePhase[] = ["middlegame", "endgame", "opening"];

  // First pass: cap each phase to available positions, accumulate surplus
  let surplus = 0;
  for (const phase of phases) {
    const available = byPhase[phase].length;
    if (targets[phase] > available) {
      surplus += targets[phase] - available;
      targets[phase] = available;
    }
  }

  // Second pass: distribute surplus to phases with room
  for (const phase of phases) {
    if (surplus <= 0) break;
    const available = byPhase[phase].length;
    const room = available - targets[phase];
    if (room > 0) {
      const extra = Math.min(room, surplus);
      targets[phase] += extra;
      surplus -= extra;
    }
  }

  // Seeded shuffle for reproducibility
  function seededShuffle<T>(arr: T[], s: number): T[] {
    const result = [...arr];
    let rng = s;
    for (let i = result.length - 1; i > 0; i--) {
      // Simple LCG
      rng = (rng * 1664525 + 1013904223) >>> 0;
      const j = rng % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // Select positions from each phase
  const selected = new Set<string>();
  for (const phase of phases) {
    const shuffled = seededShuffle(byPhase[phase], seed);
    for (let i = 0; i < targets[phase] && i < shuffled.length; i++) {
      selected.add(`${shuffled[i].gameIndex}-${shuffled[i].ply}`);
    }
  }

  return selected;
}

export async function runAccuracyTest(
  engine: ChessEngine,
  dataset: Dataset,
  runConfig: RunConfig,
  callbacks?: RunCallbacks
): Promise<TestResult> {
  const restoreRandom = patchMathRandom(runConfig.seed);
  const version = captureVersionInfo();
  const resolvedConfig = resolveFullConfig(runConfig.configOverrides);

  try {
    // 1. Build player profile from all games
    const gameRecords: GameRecord[] = dataset.games
      .filter((g) => g.variant === "standard" && g.moves)
      .map((g) => lichessGameToGameRecord(g, dataset.username));

    const evalData: GameEvalData[] = dataset.games
      .map((g) => lichessGameToEvalData(g, dataset.username))
      .filter((d): d is GameEvalData => d !== null);

    const configOverrides = runConfig.configOverrides;

    // Profile building uses DEFAULT_CONFIG (not overrides).
    // Config overrides only affect bot behavior via createBot().
    const errorProfile: ErrorProfile = buildErrorProfileFromEvals(evalData);
    const styleMetrics: StyleMetrics = analyzeStyleFromRecords(gameRecords);

    const elo = runConfig.eloOverride ?? dataset.estimatedElo;

    // Build opening tries for both colors
    const whiteTrie: OpeningTrie = buildOpeningTrie(gameRecords, "white");
    const blackTrie: OpeningTrie = buildOpeningTrie(gameRecords, "black");

    // 2. Phase-balanced sampling (when enabled)
    //    Pre-scan all positions, group by phase, sample with quotas.
    //    Without this, the first N positions are heavily skewed toward openings.
    let selectedPositions: Set<string> | null = null;
    if (runConfig.phaseBalanced && runConfig.maxPositions) {
      const allCandidates = collectCandidatePositions(
        dataset.games, dataset.username, resolvedConfig
      );
      selectedPositions = sampleWithPhaseBalance(
        allCandidates, runConfig.maxPositions, runConfig.seed
      );
    }

    // Count total positions for progress reporting
    let totalPositions = 0;
    if (selectedPositions) {
      totalPositions = selectedPositions.size;
    } else {
      for (const game of dataset.games) {
        if (!game.moves || game.variant !== "standard") continue;
        const isWhite =
          game.players.white?.user?.id?.toLowerCase() ===
          dataset.username.toLowerCase();
        const moves = game.moves.split(" ");
        for (let ply = 0; ply < moves.length; ply++) {
          const isWhiteMove = ply % 2 === 0;
          if ((isWhite && isWhiteMove) || (!isWhite && !isWhiteMove)) {
            totalPositions++;
          }
        }
      }
      if (runConfig.maxPositions && runConfig.maxPositions < totalPositions) {
        totalPositions = runConfig.maxPositions;
      }
    }

    // 3. Replay each game and collect bot predictions
    const positions: PositionResult[] = [];
    let evaluated = 0;
    let gameIndex = 0;
    let hitLimit = false;

    for (const game of dataset.games) {
      if (hitLimit) break;
      if (!game.moves || game.variant !== "standard") {
        gameIndex++;
        continue;
      }

      const isWhite =
        game.players.white?.user?.id?.toLowerCase() ===
        dataset.username.toLowerCase();
      const botColor = isWhite ? "white" : "black";
      const openingTrie = botColor === "white" ? whiteTrie : blackTrie;

      const bot = createBot(engine, {
        elo,
        errorProfile,
        openingTrie,
        botColor,
        config: configOverrides,
        styleMetrics,
      });

      const chess = new Chess();
      const moves = game.moves.split(" ");

      // Compute per-ply eval data for CPL calculation
      const gameEvalData = lichessGameToEvalData(game, dataset.username);
      const evals = gameEvalData?.evals ?? [];

      for (let ply = 0; ply < moves.length; ply++) {
        const isWhiteMove = ply % 2 === 0;
        const isPlayerMove =
          (isWhite && isWhiteMove) || (!isWhite && !isWhiteMove);

        if (isPlayerMove) {
          // Phase-balanced mode: skip positions not in the selected set
          if (selectedPositions && !selectedPositions.has(`${gameIndex}-${ply}`)) {
            // Still need to advance the game below
            try { chess.move(moves[ply]); } catch { break; }
            continue;
          }

          const fen = chess.fen();
          const actualSan = moves[ply];

          // Convert actual SAN to UCI
          const testChess = new Chess(fen);
          const moveObj = testChess.move(actualSan);
          if (!moveObj) break;
          const actualUci =
            moveObj.from + moveObj.to + (moveObj.promotion || "");

          // Get bot's move
          const botResult = await bot.getMove(fen);

          // Get MultiPV candidates for top-N accuracy and botCPL
          let isInTopN = false;
          let candidates: CandidateMove[] = [];
          if (!runConfig.skipTopN) {
            // Full-strength check (original behavior)
            candidates = await engine.evaluateMultiPV(fen, 12, 4);
            isInTopN = candidates.some((c) => c.uci === actualUci);
          } else if (botResult.candidates && botResult.candidates.length > 0) {
            // Triage mode: use bot's own candidates (no extra Stockfish call)
            candidates = botResult.candidates;
            isInTopN = candidates.some((c) => c.uci === actualUci);
          }

          // CPL calculation from Lichess evals
          let actualCPL: number | undefined;
          if (ply > 0 && ply < evals.length && ply - 1 < evals.length) {
            const evalBefore = evals[ply - 1];
            const evalAfter = evals[ply];
            if (!isNaN(evalBefore) && !isNaN(evalAfter)) {
              // CPL from player's perspective
              const sign = isWhite ? 1 : -1;
              actualCPL = Math.max(
                0,
                sign * (evalBefore - evalAfter)
              );
            }
          }

          // Fallback: compute playerCPL from candidates when Lichess evals unavailable
          if (actualCPL === undefined && candidates.length > 0) {
            const bestScore = candidates[0].score;
            const playerCandidate = candidates.find(
              (c) => c.uci === actualUci
            );
            if (playerCandidate) {
              actualCPL = Math.max(0, bestScore - playerCandidate.score);
            } else {
              // Player's move is worse than ALL candidates — use worst candidate
              // gap as a conservative lower bound for their CPL
              const worstScore = candidates[candidates.length - 1].score;
              actualCPL = Math.max(0, bestScore - worstScore);
            }
          }

          // Bot CPL from candidate scores
          let botCPL: number | undefined;
          if (candidates.length > 0) {
            const bestScore = candidates[0].score;
            const botCandidate = candidates.find(
              (c) => c.uci === botResult.uci
            );
            if (botCandidate) {
              botCPL = Math.max(0, bestScore - botCandidate.score);
            }
          }

          positions.push({
            gameIndex,
            ply,
            fen,
            phase: botResult.phase,
            actualUci,
            actualSan,
            botUci: botResult.uci,
            botSource: botResult.source,
            isMatch: botResult.uci === actualUci,
            isInTopN,
            dynamicSkill: botResult.dynamicSkill,
            actualCPL,
            botCPL,
          });

          evaluated++;
          if (callbacks?.onProgress) {
            callbacks.onProgress(evaluated, totalPositions);
          }

          // In phase-balanced mode, stop when all selected positions are evaluated.
          // In sequential mode, stop at maxPositions.
          if (selectedPositions) {
            if (evaluated >= selectedPositions.size) {
              hitLimit = true;
              break;
            }
          } else if (runConfig.maxPositions && evaluated >= runConfig.maxPositions) {
            hitLimit = true;
            break;
          }
        }

        // Advance the game
        try {
          chess.move(moves[ply]);
        } catch {
          break;
        }
      }

      gameIndex++;
    }

    // 4. Compute aggregate metrics
    const metrics = computeMetrics(positions);

    return {
      datasetName: dataset.name,
      username: dataset.username,
      timestamp: new Date().toISOString(),
      seed: runConfig.seed,
      label: runConfig.label,
      elo,
      configOverrides: runConfig.configOverrides,
      version,
      resolvedConfig,
      metrics,
      positions,
    };
  } finally {
    restoreRandom();
  }
}

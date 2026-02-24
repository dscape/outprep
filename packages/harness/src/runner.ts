/**
 * Core test runner — replays games position-by-position and compares
 * the bot's move choices against the actual player's moves.
 */

import { Chess } from "chess.js";
import {
  createBot,
  buildErrorProfileFromEvals,
  buildOpeningTrie,
  type ChessEngine,
  type BotConfig,
  type ErrorProfile,
  type OpeningTrie,
  type GameRecord,
  type GameEvalData,
} from "@outprep/engine";
import { patchMathRandom } from "./seeded-random";
import { lichessGameToGameRecord, lichessGameToEvalData } from "./lichess-adapters";
import { computeMetrics } from "./metrics";
import { progressBar } from "./format";
import { captureVersionInfo, resolveFullConfig } from "./version";
import type { Dataset, RunConfig, TestResult, PositionResult } from "./types";

export interface RunCallbacks {
  onProgress?: (evaluated: number, total: number) => void;
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

    const elo = runConfig.eloOverride ?? dataset.estimatedElo;

    // Build opening tries for both colors
    const whiteTrie: OpeningTrie = buildOpeningTrie(gameRecords, "white");
    const blackTrie: OpeningTrie = buildOpeningTrie(gameRecords, "black");

    // 2. Count total player-move positions for progress reporting
    let totalPositions = 0;
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

          // Get MultiPV candidates for top-N accuracy
          const candidates = await engine.evaluateMultiPV(fen, 12, 4);
          const isInTopN = candidates.some((c) => c.uci === actualUci);

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

          if (runConfig.maxPositions && evaluated >= runConfig.maxPositions) {
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

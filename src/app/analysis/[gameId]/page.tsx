"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Chess } from "chess.js";
import { GameAnalysis, PlayerProfile, MoveEval, AnalysisSummary } from "@/lib/types";
import { StockfishEngine } from "@/lib/stockfish-worker";
import { evaluateGame } from "@/lib/analysis/stockfish-eval";
import { classifyPositions } from "@/lib/analysis/position-classifier";
import { tagMoments } from "@/lib/analysis/opponent-context";
import { generateNarrative } from "@/lib/analysis/template-engine";
import { lookupOpening } from "@/lib/analysis/opening-lookup";
import { describeMoveError } from "@/lib/analysis/move-descriptions";
import AnalysisCard from "@/components/AnalysisCard";
import GameReplay from "@/components/GameReplay";

interface StoredGame {
  pgn: string;
  result: string;
  playerColor: "white" | "black";
  opponentUsername: string;
  opponentFideEstimate?: number;
  precomputedMoves?: MoveEval[];
  precomputedSummary?: AnalysisSummary;
  scoutedUsername?: string; // When reviewing a scouted player's game (not your own)
}

export default function AnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params.gameId as string;

  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [gameData, setGameData] = useState<StoredGame | null>(null);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    async function runAnalysis() {
      // Retrieve game data from sessionStorage
      const raw = sessionStorage.getItem(`game:${gameId}`);
      if (!raw) {
        setError("Game data not found. Please play a new game.");
        return;
      }

      const gd: StoredGame = JSON.parse(raw);
      setGameData(gd); // Show board and context immediately

      try {
        // Step 0: Fetch opponent profile + opening in parallel
        setStage("Loading opponent profile...");

        const [profile, opening] = await Promise.all([
          fetchProfile(gd.opponentUsername),
          lookupOpening(gd.pgn),
        ]);

        let moves: MoveEval[];
        let summary: AnalysisSummary;

        // Check for pre-computed analysis from live game analyzer
        if (gd.precomputedMoves && gd.precomputedSummary) {
          // Skip Step 1 entirely — use pre-computed analysis (instant!)
          setStage("Loading pre-computed analysis...");
          moves = gd.precomputedMoves;
          summary = gd.precomputedSummary;
        } else {
          // Fallback: run full Stockfish analysis (slow path)
          setStage("Running engine analysis...");
          const engine = new StockfishEngine();
          await engine.init();

          const result = await evaluateGame(
            gd.pgn,
            engine,
            (ply, total) => {
              setProgress(Math.round((ply / total) * 100));
            },
            gd.playerColor,
          );

          moves = result.moves;
          summary = result.summary;
          engine.quit();
        }

        // Step 2: Generate English descriptions for errors
        setStage("Analyzing mistakes...");
        for (const move of moves) {
          if (
            move.classification === "blunder" ||
            move.classification === "mistake" ||
            move.classification === "inaccuracy"
          ) {
            move.description = describeMoveError(move);
          }
        }

        // Step 3: Position classification
        setStage("Classifying positions...");
        const contexts = classifyPositions(gd.pgn, moves);

        // Step 4: Opponent context overlay
        setStage("Cross-referencing opponent patterns...");
        const keyMoments = profile
          ? tagMoments(moves, contexts, profile, gd.playerColor, gd.scoutedUsername)
          : [];

        // Step 5: Generate narrative
        setStage("Generating coaching analysis...");
        const chess = new Chess();
        chess.loadPgn(gd.pgn);
        const totalMoves = Math.ceil(chess.history().length / 2);

        const resultType = gd.result === "1-0"
          ? (gd.playerColor === "white" ? "win" : "loss")
          : gd.result === "0-1"
            ? (gd.playerColor === "black" ? "win" : "loss")
            : "draw";

        const coachingNarrative = profile
          ? generateNarrative({
              result: resultType as "win" | "loss" | "draw",
              playerColor: gd.playerColor,
              opening,
              summary,
              keyMoments,
              profile,
              totalMoves,
            })
          : `Game analysis complete. Your accuracy was ${summary.accuracy}% with ${summary.blunders} blunder(s) and ${summary.mistakes} mistake(s). Average centipawn loss: ${summary.averageCentipawnLoss}.`;

        setAnalysis({
          gameId,
          pgn: gd.pgn,
          result: gd.result,
          opening,
          totalMoves,
          playerColor: gd.playerColor,
          opponentUsername: gd.opponentUsername,
          summary,
          moves,
          keyMoments,
          coachingNarrative,
          opponentFideEstimate: gd.opponentFideEstimate,
          scoutedUsername: gd.scoutedUsername,
        });

        setStage("");
      } catch (err) {
        console.error("Analysis error:", err);
        setError("Analysis failed. The engine may not have loaded correctly.");
      }
    }

    runAnalysis();
  }, [gameId]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-xl font-bold text-white mb-2">Analysis Error</h2>
          <p className="text-zinc-400 mb-4">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700"
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  // Progressive loading: show board and context while analysis runs
  if (!analysis && gameData) {
    const playerLabel = gameData.scoutedUsername || "You";
    const resultLabel = gameData.result === "1-0"
      ? (gameData.playerColor === "white" ? `${playerLabel} won` : `${playerLabel} lost`)
      : gameData.result === "0-1"
        ? (gameData.playerColor === "black" ? `${playerLabel} won` : `${playerLabel} lost`)
        : "Draw";

    return (
      <div className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex items-center justify-between">
            <button
              onClick={() =>
                router.push(`/scout/${encodeURIComponent(gameData.scoutedUsername || gameData.opponentUsername)}`)
              }
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              &larr; Back to {gameData.scoutedUsername || gameData.opponentUsername}
            </button>
          </div>

          {/* Game context */}
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-4 mb-6">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-zinc-300 font-medium">
                vs {gameData.opponentUsername}
              </span>
              <span className="text-zinc-500">{gameData.result}</span>
              <span className={`font-medium ${
                resultLabel === "You won" ? "text-green-400" :
                resultLabel === "You lost" ? "text-red-400" :
                "text-zinc-400"
              }`}>
                {resultLabel}
              </span>
            </div>
          </div>

          {/* Playable game replay while analysis runs */}
          <GameReplay
            pgn={gameData.pgn}
            whiteName={gameData.playerColor === "white" ? playerLabel : gameData.opponentUsername}
            blackName={gameData.playerColor === "black" ? playerLabel : gameData.opponentUsername}
          />

          {/* Analysis progress */}
          <div className="mt-6 flex flex-col items-center">
            <div className="h-8 w-8 rounded-full border-2 border-green-500 border-t-transparent animate-spin mb-3" />
            <p className="text-white font-medium text-sm mb-1">{stage}</p>
            {progress > 0 && (
              <div className="w-full max-w-xs mt-2">
                <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-zinc-500 text-center">{progress}% complete</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Initial loading (before sessionStorage is read)
  if (!analysis) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="h-10 w-10 mx-auto rounded-full border-2 border-green-500 border-t-transparent animate-spin mb-4" />
          <p className="text-white font-medium mb-2">{stage || "Loading..."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() =>
              router.push(`/scout/${encodeURIComponent(analysis.scoutedUsername || analysis.opponentUsername)}`)
            }
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            &larr; Back to {analysis.scoutedUsername || analysis.opponentUsername}
          </button>
          <button
            onClick={() =>
              router.push(`/play/${encodeURIComponent(analysis.scoutedUsername || analysis.opponentUsername)}`)
            }
            className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-500 transition-colors"
          >
            Practice against {analysis.scoutedUsername || analysis.opponentUsername}
          </button>
        </div>

        <AnalysisCard analysis={analysis} />
      </div>
    </div>
  );
}

async function fetchProfile(username: string): Promise<PlayerProfile | null> {
  // 1. Try Lichess API
  try {
    const res = await fetch(
      `/api/analysis?username=${encodeURIComponent(username)}`
    );
    if (res.ok) return res.json();
  } catch {
    // Non-fatal — fall through to PGN fallback
  }

  // 2. Fallback: build a minimal profile from PGN-imported data in sessionStorage
  try {
    const stored = sessionStorage.getItem(`pgn-import:${username}`);
    if (stored) {
      const otb = JSON.parse(stored) as {
        totalGames: number;
        style: PlayerProfile["style"];
        openings: PlayerProfile["openings"];
        weaknesses: PlayerProfile["weaknesses"];
      };
      return {
        username,
        platform: "lichess",
        totalGames: otb.totalGames,
        analyzedGames: otb.totalGames,
        ratings: {},
        fideEstimate: { rating: 0, confidence: 0 },
        style: otb.style,
        weaknesses: otb.weaknesses,
        openings: otb.openings,
        prepTips: [],
        bySpeed: {},
        lastComputed: Date.now(),
      } as PlayerProfile;
    }
  } catch {
    // Non-fatal
  }

  return null;
}

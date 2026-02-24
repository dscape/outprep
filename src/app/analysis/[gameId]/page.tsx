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

interface StoredGame {
  pgn: string;
  result: string;
  playerColor: "white" | "black";
  opponentUsername: string;
  opponentFideEstimate?: number;
  precomputedMoves?: MoveEval[];
  precomputedSummary?: AnalysisSummary;
}

export default function AnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params.gameId as string;

  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
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

      const gameData: StoredGame = JSON.parse(raw);

      try {
        // Step 0: Fetch opponent profile + opening in parallel
        setStage("Loading opponent profile...");

        const [profile, opening] = await Promise.all([
          fetchProfile(gameData.opponentUsername),
          lookupOpening(gameData.pgn),
        ]);

        let moves: MoveEval[];
        let summary: AnalysisSummary;

        // Check for pre-computed analysis from live game analyzer
        if (gameData.precomputedMoves && gameData.precomputedSummary) {
          // Skip Step 1 entirely — use pre-computed analysis (instant!)
          setStage("Loading pre-computed analysis...");
          moves = gameData.precomputedMoves;
          summary = gameData.precomputedSummary;
        } else {
          // Fallback: run full Stockfish analysis (slow path, ~3-7 min)
          setStage("Running engine analysis...");
          const engine = new StockfishEngine();
          await engine.init();

          const result = await evaluateGame(
            gameData.pgn,
            engine,
            (ply, total) => {
              setProgress(Math.round((ply / total) * 100));
            },
            gameData.playerColor,
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
        const contexts = classifyPositions(gameData.pgn, moves);

        // Step 4: Opponent context overlay
        setStage("Cross-referencing opponent patterns...");
        const keyMoments = profile
          ? tagMoments(moves, contexts, profile, gameData.playerColor)
          : [];

        // Step 5: Generate narrative
        setStage("Generating coaching analysis...");
        const chess = new Chess();
        chess.loadPgn(gameData.pgn);
        const totalMoves = Math.ceil(chess.history().length / 2);

        const resultType = gameData.result === "1-0"
          ? (gameData.playerColor === "white" ? "win" : "loss")
          : gameData.result === "0-1"
            ? (gameData.playerColor === "black" ? "win" : "loss")
            : "draw";

        const coachingNarrative = profile
          ? generateNarrative({
              result: resultType as "win" | "loss" | "draw",
              playerColor: gameData.playerColor,
              opening,
              summary,
              keyMoments,
              profile,
              totalMoves,
            })
          : `Game analysis complete. Your accuracy was ${summary.accuracy}% with ${summary.blunders} blunder(s) and ${summary.mistakes} mistake(s). Average centipawn loss: ${summary.averageCentipawnLoss}.`;

        setAnalysis({
          gameId,
          pgn: gameData.pgn,
          result: gameData.result,
          opening,
          totalMoves,
          playerColor: gameData.playerColor,
          opponentUsername: gameData.opponentUsername,
          summary,
          moves,
          keyMoments,
          coachingNarrative,
          opponentFideEstimate: gameData.opponentFideEstimate,
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

  if (!analysis) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="h-10 w-10 mx-auto rounded-full border-2 border-green-500 border-t-transparent animate-spin mb-4" />
          <p className="text-white font-medium mb-2">{stage}</p>
          {progress > 0 && (
            <div className="mt-3">
              <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-zinc-500">{progress}% complete</p>
            </div>
          )}
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
              router.push(`/scout/${encodeURIComponent(analysis.opponentUsername)}`)
            }
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            &larr; Back to {analysis.opponentUsername}
          </button>
          <button
            onClick={() =>
              router.push(`/play/${encodeURIComponent(analysis.opponentUsername)}`)
            }
            className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-500 transition-colors"
          >
            Play again
          </button>
        </div>

        <AnalysisCard analysis={analysis} />
      </div>
    </div>
  );
}

async function fetchProfile(username: string): Promise<PlayerProfile | null> {
  try {
    const res = await fetch(
      `/api/analysis?username=${encodeURIComponent(username)}`
    );
    if (res.ok) return res.json();
  } catch {
    // Non-fatal
  }
  return null;
}

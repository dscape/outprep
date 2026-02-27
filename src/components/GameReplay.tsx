"use client";

import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import type { MoveEval, AnalysisSummary } from "@/lib/types";
import {
  classColor,
  classBg,
  classIcon,
  classLabel,
  isErrorMove,
  FullEvalBar,
} from "./analysis-shared";

/* ── Types ──────────────────────────────────────────────── */

interface ParsedMove {
  ply: number; // 1-based
  san: string;
  fenBefore: string;
  fenAfter: string;
}

interface GameReplayProps {
  pgn: string;
  whiteName: string;
  blackName: string;
}

/* ── Helpers ────────────────────────────────────────────── */

function qualityLabel(accuracy: number): { label: string; color: string } {
  if (accuracy >= 98) return { label: "Brilliant", color: "text-cyan-400" };
  if (accuracy >= 93) return { label: "Excellent", color: "text-green-400" };
  if (accuracy >= 85) return { label: "Great", color: "text-green-400" };
  if (accuracy >= 75) return { label: "Good", color: "text-yellow-400" };
  if (accuracy >= 60) return { label: "Inaccurate", color: "text-orange-400" };
  return { label: "Poor", color: "text-red-400" };
}

/* ── Move button (pre-analysis: plain text) ─────────────── */

function PlainMoveButton({
  ply,
  san,
  isSelected,
  onClick,
}: {
  ply: number;
  san: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-ply={ply}
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded text-sm font-mono transition-all ${
        isSelected
          ? "bg-green-600/30 text-white ring-1 ring-green-500/50"
          : "text-zinc-300 hover:bg-zinc-700/50"
      }`}
    >
      {san}
    </button>
  );
}

/* ── Analyzed move button (post-analysis: colored) ──────── */

function AnalyzedMoveButton({
  move,
  isSelected,
  onClick,
}: {
  move: MoveEval;
  isSelected: boolean;
  onClick: () => void;
}) {
  const icon = classIcon(move.classification);
  const color = classColor(move.classification);
  const isNonNormal =
    move.classification !== "normal" && move.classification !== "good";

  return (
    <button
      data-ply={move.ply}
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded text-sm font-mono transition-all ${
        isSelected
          ? "bg-green-600/30 text-white ring-1 ring-green-500/50"
          : "text-zinc-300 hover:bg-zinc-700/50"
      } ${isNonNormal && !isSelected ? classBg(move.classification).split(" ")[0] : ""}`}
    >
      {move.san}
      {icon && <span className={`ml-0.5 text-xs ${color}`}>{icon}</span>}
    </button>
  );
}

/* ── Summary row ────────────────────────────────────────── */

function SideSummary({
  label,
  summary,
}: {
  label: string;
  summary: AnalysisSummary;
}) {
  const q = qualityLabel(summary.accuracy);
  return (
    <div className="flex-1 rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-zinc-500 uppercase tracking-wide">
          {label}
        </span>
        <span className={`text-sm font-bold ${q.color}`}>
          {summary.accuracy.toFixed(1)}% {q.label}
        </span>
      </div>
      <div className="flex gap-3 text-xs text-zinc-400">
        {summary.blunders > 0 && (
          <span className="text-red-400">{summary.blunders} blunder{summary.blunders !== 1 ? "s" : ""}</span>
        )}
        {summary.mistakes > 0 && (
          <span className="text-yellow-400">{summary.mistakes} mistake{summary.mistakes !== 1 ? "s" : ""}</span>
        )}
        {summary.inaccuracies > 0 && (
          <span className="text-orange-400">{summary.inaccuracies} inaccurac{summary.inaccuracies !== 1 ? "ies" : "y"}</span>
        )}
        {summary.blunders === 0 && summary.mistakes === 0 && summary.inaccuracies === 0 && (
          <span className="text-green-400">No errors</span>
        )}
      </div>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────── */

export default function GameReplay({
  pgn,
  whiteName,
  blackName,
}: GameReplayProps) {
  /* ── PGN parsing ────────────────────────────────────── */
  const parsedMoves = useMemo<ParsedMove[]>(() => {
    try {
      const chess = new Chess();
      chess.loadPgn(pgn);
      const history = chess.history();

      // Restart from beginning (or custom FEN)
      const fenHeader = pgn.match(/\[FEN "([^"]+)"\]/);
      if (fenHeader) {
        chess.load(fenHeader[1]);
      } else {
        chess.reset();
      }

      const moves: ParsedMove[] = [];
      for (let i = 0; i < history.length; i++) {
        const fenBefore = chess.fen();
        chess.move(history[i]);
        moves.push({
          ply: i + 1,
          san: history[i],
          fenBefore,
          fenAfter: chess.fen(),
        });
      }
      return moves;
    } catch {
      return [];
    }
  }, [pgn]);

  const startingFen = useMemo(() => {
    const fenHeader = pgn.match(/\[FEN "([^"]+)"\]/);
    return (
      fenHeader?.[1] ??
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    );
  }, [pgn]);

  /* ── Navigation state ───────────────────────────────── */
  const [currentPly, setCurrentPly] = useState(0); // 0 = start
  const [boardOrientation, setBoardOrientation] = useState<
    "white" | "black"
  >("white");
  const currentPlyRef = useRef(currentPly);
  currentPlyRef.current = currentPly;

  const moveListRef = useRef<HTMLDivElement>(null);

  const goFirst = useCallback(() => setCurrentPly(0), []);
  const goPrev = useCallback(() => {
    setCurrentPly((p) => Math.max(0, p - 1));
  }, []);
  const goNext = useCallback(() => {
    setCurrentPly((p) => Math.min(parsedMoves.length, p + 1));
  }, [parsedMoves.length]);
  const goLast = useCallback(
    () => setCurrentPly(parsedMoves.length),
    [parsedMoves.length]
  );

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
      if (e.key === "Home") {
        e.preventDefault();
        goFirst();
      }
      if (e.key === "End") {
        e.preventDefault();
        goLast();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goFirst, goPrev, goNext, goLast]);

  // Auto-scroll selected move into view
  useEffect(() => {
    if (currentPly === 0 || !moveListRef.current) return;
    const el = moveListRef.current.querySelector(
      `[data-ply="${currentPly}"]`
    );
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentPly]);

  /* ── Board position ─────────────────────────────────── */
  const currentFen = useMemo(() => {
    if (currentPly === 0) return startingFen;
    return parsedMoves[currentPly - 1]?.fenAfter ?? startingFen;
  }, [currentPly, parsedMoves, startingFen]);

  /* ── Analysis state ─────────────────────────────────── */
  const [analysisState, setAnalysisState] = useState<
    "idle" | "loading" | "analyzing" | "complete"
  >("idle");
  const [analysisProgress, setAnalysisProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [moveEvals, setMoveEvals] = useState<MoveEval[] | null>(null);
  const [whiteSummary, setWhiteSummary] = useState<AnalysisSummary | null>(
    null
  );
  const [blackSummary, setBlackSummary] = useState<AnalysisSummary | null>(
    null
  );
  const engineRef = useRef<{ quit: () => void } | null>(null);

  const handleRunAnalysis = useCallback(async () => {
    setAnalysisState("loading");
    try {
      const { StockfishEngine } = await import("@/lib/stockfish-worker");
      const engine = new StockfishEngine();
      engineRef.current = engine;
      await engine.init();

      setAnalysisState("analyzing");

      const { evaluateGame } = await import(
        "@/lib/analysis/stockfish-eval"
      );
      const { computeSummary } = await import(
        "@/lib/analysis/stockfish-eval"
      );

      const { moves } = await evaluateGame(
        pgn,
        engine,
        (done, total) => setAnalysisProgress({ done, total })
      );

      engine.quit();
      engineRef.current = null;

      setMoveEvals(moves);
      setWhiteSummary(computeSummary(moves, "white"));
      setBlackSummary(computeSummary(moves, "black"));
      setAnalysisState("complete");
      setAnalysisProgress(null);
    } catch (err) {
      console.error("Analysis failed:", err);
      setAnalysisState("idle");
      setAnalysisProgress(null);
    }
  }, [pgn]);

  const handleCancelAnalysis = useCallback(() => {
    engineRef.current?.quit();
    engineRef.current = null;
    setAnalysisState("idle");
    setAnalysisProgress(null);
  }, []);

  /* ── Board arrows for error moves (post-analysis) ─── */
  const boardArrows = useMemo(() => {
    if (!moveEvals || currentPly === 0) return [];
    const move = moveEvals.find((m) => m.ply === currentPly);
    if (!move || !isErrorMove(move)) return [];

    const arrows: {
      startSquare: string;
      endSquare: string;
      color: string;
    }[] = [];

    if (move.bestMove && move.bestMove.length >= 4) {
      arrows.push({
        startSquare: move.bestMove.substring(0, 2),
        endSquare: move.bestMove.substring(2, 4),
        color: "rgba(0, 180, 0, 0.7)",
      });
    }
    if (move.exploitMove && move.exploitMove.length >= 4) {
      arrows.push({
        startSquare: move.exploitMove.substring(0, 2),
        endSquare: move.exploitMove.substring(2, 4),
        color: "rgba(220, 40, 40, 0.7)",
      });
    }

    return arrows;
  }, [moveEvals, currentPly]);

  /* ── Current eval for eval bar ──────────────────────── */
  const currentEval = useMemo(() => {
    if (!moveEvals || currentPly === 0) return 0;
    const move = moveEvals.find((m) => m.ply === currentPly);
    return move?.eval ?? 0;
  }, [moveEvals, currentPly]);

  /* ── Selected move info ─────────────────────────────── */
  const selectedMoveEval = useMemo(() => {
    if (!moveEvals || currentPly === 0) return null;
    return moveEvals.find((m) => m.ply === currentPly) ?? null;
  }, [moveEvals, currentPly]);

  /* ── Move pairs for display ─────────────────────────── */
  const movePairs = useMemo(() => {
    const pairs: { num: number; white?: ParsedMove; black?: ParsedMove }[] =
      [];
    for (const move of parsedMoves) {
      const num = Math.ceil(move.ply / 2);
      if (move.ply % 2 === 1) {
        pairs.push({ num, white: move });
      } else {
        const last = pairs[pairs.length - 1];
        if (last && last.num === num) {
          last.black = move;
        } else {
          pairs.push({ num, black: move });
        }
      }
    }
    return pairs;
  }, [parsedMoves]);

  /* ── Copy PGN + Lichess import ──────────────────────── */
  const [copiedPgn, setCopiedPgn] = useState(false);
  const [lichessImporting, setLichessImporting] = useState(false);

  const handleCopyPgn = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pgn);
      setCopiedPgn(true);
      setTimeout(() => setCopiedPgn(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = pgn;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopiedPgn(true);
      setTimeout(() => setCopiedPgn(false), 2000);
    }
  }, [pgn]);

  const handleOpenLichess = useCallback(async () => {
    setLichessImporting(true);
    try {
      const res = await fetch("https://lichess.org/api/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ pgn }),
      });
      if (!res.ok) throw new Error(`Import failed: ${res.status}`);
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank");
    } catch (err) {
      console.error("Lichess import failed:", err);
    } finally {
      setLichessImporting(false);
    }
  }, [pgn]);

  if (parsedMoves.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        Unable to parse game moves from PGN.
      </p>
    );
  }

  /* ── Render ─────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      {/* Board + Move list */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Eval bar + Board */}
        <div className="flex-shrink-0">
          <div className="flex gap-2" style={{ width: "fit-content" }}>
            {/* Eval bar — only visible after analysis */}
            {analysisState === "complete" && (
              <FullEvalBar
                evalCp={currentEval}
                orientation={boardOrientation}
              />
            )}
            <div className="w-[280px] sm:w-[360px]">
              <Chessboard
                options={{
                  position: currentFen,
                  boardOrientation: boardOrientation,
                  allowDragging: false,
                  arrows: boardArrows,
                  boardStyle: { borderRadius: "4px" },
                  darkSquareStyle: { backgroundColor: "#779952" },
                  lightSquareStyle: { backgroundColor: "#edeed1" },
                }}
              />
            </div>
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-center gap-2 mt-3">
            <button
              onClick={goFirst}
              className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
              title="First move (Home)"
            >
              ⏮
            </button>
            <button
              onClick={goPrev}
              className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
              title="Previous move (←)"
            >
              ◀
            </button>
            <span className="text-xs text-zinc-600 font-mono min-w-[60px] text-center">
              {currentPly === 0
                ? "Start"
                : `${Math.ceil(currentPly / 2)}${currentPly % 2 === 1 ? "." : "..."}`}
            </span>
            <button
              onClick={goNext}
              className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
              title="Next move (→)"
            >
              ▶
            </button>
            <button
              onClick={goLast}
              className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
              title="Last move (End)"
            >
              ⏭
            </button>
            <button
              onClick={() =>
                setBoardOrientation((o) =>
                  o === "white" ? "black" : "white"
                )
              }
              className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors ml-2"
              title="Flip board"
            >
              ⟲
            </button>
          </div>
          <p className="text-[10px] text-zinc-600 text-center mt-1">
            Use arrow keys ← → to navigate
          </p>
        </div>

        {/* Move list */}
        <div
          ref={moveListRef}
          className="flex-1 overflow-y-auto max-h-[400px] rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-3"
        >
          <div className="space-y-0.5">
            {movePairs.map((pair) => (
              <div key={pair.num} className="flex items-center gap-1">
                <span className="text-xs text-zinc-600 font-mono w-7 text-right flex-shrink-0">
                  {pair.num}.
                </span>
                {pair.white &&
                  (moveEvals ? (
                    <AnalyzedMoveButton
                      move={
                        moveEvals.find((m) => m.ply === pair.white!.ply) ?? {
                          ply: pair.white.ply,
                          san: pair.white.san,
                          fen: pair.white.fenBefore,
                          eval: 0,
                          bestMove: "",
                          bestMoveSan: "",
                          evalDelta: 0,
                          classification: "normal" as const,
                        }
                      }
                      isSelected={currentPly === pair.white.ply}
                      onClick={() => setCurrentPly(pair.white!.ply)}
                    />
                  ) : (
                    <PlainMoveButton
                      ply={pair.white.ply}
                      san={pair.white.san}
                      isSelected={currentPly === pair.white.ply}
                      onClick={() => setCurrentPly(pair.white!.ply)}
                    />
                  ))}
                {pair.black &&
                  (moveEvals ? (
                    <AnalyzedMoveButton
                      move={
                        moveEvals.find((m) => m.ply === pair.black!.ply) ?? {
                          ply: pair.black.ply,
                          san: pair.black.san,
                          fen: pair.black.fenBefore,
                          eval: 0,
                          bestMove: "",
                          bestMoveSan: "",
                          evalDelta: 0,
                          classification: "normal" as const,
                        }
                      }
                      isSelected={currentPly === pair.black.ply}
                      onClick={() => setCurrentPly(pair.black!.ply)}
                    />
                  ) : (
                    <PlainMoveButton
                      ply={pair.black.ply}
                      san={pair.black.san}
                      isSelected={currentPly === pair.black.ply}
                      onClick={() => setCurrentPly(pair.black!.ply)}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Selected move info (post-analysis) */}
      {selectedMoveEval && isErrorMove(selectedMoveEval) && (
        <div
          className={`rounded-lg border p-3 text-sm ${classBg(selectedMoveEval.classification)}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className={`font-bold ${classColor(selectedMoveEval.classification)}`}>
              {classIcon(selectedMoveEval.classification)}{" "}
              {classLabel(selectedMoveEval.classification)}
            </span>
            <span className="text-zinc-400">
              {Math.ceil(selectedMoveEval.ply / 2)}.
              {selectedMoveEval.ply % 2 === 1 ? "" : ".."}{" "}
              {selectedMoveEval.san}
            </span>
          </div>
          {selectedMoveEval.bestMoveSan && (
            <p className="text-zinc-400">
              Best was{" "}
              <span className="font-mono text-green-400">
                {selectedMoveEval.bestMoveSan}
              </span>
              {selectedMoveEval.evalDelta > 0 && (
                <span className="text-zinc-500 ml-1">
                  ({selectedMoveEval.evalDelta > 0 ? "+" : ""}
                  {(selectedMoveEval.evalDelta / 100).toFixed(1)} pawns)
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Analysis button / progress */}
      {analysisState === "idle" && (
        <button
          onClick={handleRunAnalysis}
          className="w-full rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm font-medium text-green-400 hover:bg-green-500/20 hover:border-green-500/50 transition-all"
        >
          ♟ Run Stockfish Analysis
        </button>
      )}

      {analysisState === "loading" && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 px-4 py-3 text-sm text-zinc-400 text-center">
          <span className="animate-pulse">Loading analysis engine...</span>
        </div>
      )}

      {analysisState === "analyzing" && analysisProgress && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 px-4 py-3">
          <div className="flex items-center justify-between text-sm text-zinc-400 mb-2">
            <span>
              Analyzing move {analysisProgress.done}/{analysisProgress.total}...
            </span>
            <button
              onClick={handleCancelAnalysis}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
            >
              Cancel
            </button>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{
                width: `${(analysisProgress.done / analysisProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Analysis summary (post-analysis) */}
      {analysisState === "complete" && whiteSummary && blackSummary && (
        <div className="flex flex-col sm:flex-row gap-3">
          <SideSummary label={whiteName} summary={whiteSummary} />
          <SideSummary label={blackName} summary={blackSummary} />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={handleCopyPgn}
          className="flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/50 hover:text-white"
        >
          {copiedPgn ? "Copied!" : "Copy PGN"}
        </button>
        <button
          onClick={handleOpenLichess}
          disabled={lichessImporting}
          className="flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/50 hover:text-white disabled:opacity-50"
        >
          {lichessImporting ? "Importing..." : "Open on Lichess"}
        </button>
      </div>
    </div>
  );
}

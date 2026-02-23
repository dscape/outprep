"use client";

import { useState, useMemo } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import { GameAnalysis, MoveEval, MomentTag } from "@/lib/types";

interface AnalysisCardProps {
  analysis: GameAnalysis;
}

/* ── Classification helpers ─────────────────────────────── */

function classColor(c: MoveEval["classification"]): string {
  switch (c) {
    case "blunder":    return "text-red-400";
    case "mistake":    return "text-yellow-400";
    case "inaccuracy": return "text-orange-400";
    case "great":      return "text-cyan-400";
    case "good":       return "text-green-400";
    default:           return "text-zinc-400";
  }
}

function classBg(c: MoveEval["classification"]): string {
  switch (c) {
    case "blunder":    return "bg-red-500/20 border-red-500/30";
    case "mistake":    return "bg-yellow-500/20 border-yellow-500/30";
    case "inaccuracy": return "bg-orange-500/20 border-orange-500/30";
    case "great":      return "bg-cyan-500/20 border-cyan-500/30";
    case "good":       return "bg-green-500/20 border-green-500/30";
    default:           return "bg-zinc-800/50 border-zinc-700/30";
  }
}

function classIcon(c: MoveEval["classification"]): string {
  switch (c) {
    case "blunder":    return "??";
    case "mistake":    return "?";
    case "inaccuracy": return "?!";
    case "great":      return "!!";
    case "good":       return "!";
    default:           return "";
  }
}

function classLabel(c: MoveEval["classification"]): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/* ── Sub-components ─────────────────────────────────────── */

function TagBadge({ tag }: { tag: MomentTag }) {
  const styles: Record<MomentTag, string> = {
    "EXPECTED":  "bg-zinc-600/30 text-zinc-300 border-zinc-500/30",
    "PREP HIT":  "bg-green-600/20 text-green-400 border-green-500/30",
    "YOUR ERROR":"bg-red-600/20 text-red-400 border-red-500/30",
    "EXPLOITED": "bg-purple-600/20 text-purple-400 border-purple-500/30",
    "PREDICTED": "bg-yellow-600/20 text-yellow-400 border-yellow-500/30",
  };

  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${styles[tag]}`}
    >
      {tag}
    </span>
  );
}

function EvalBar({ value }: { value: number }) {
  const normalized = Math.max(-1, Math.min(1, value / 300));
  const pct = ((normalized + 1) / 2) * 100;
  return (
    <div className="flex h-3 w-16 overflow-hidden rounded-sm bg-zinc-800">
      <div className="bg-white" style={{ width: `${pct}%` }} />
      <div className="bg-zinc-600" style={{ width: `${100 - pct}%` }} />
    </div>
  );
}

function StatBox({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "red" | "yellow";
}) {
  const valueColor =
    highlight === "red"
      ? "text-red-400"
      : highlight === "yellow"
        ? "text-yellow-400"
        : "text-white";

  return (
    <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-3 text-center">
      <div className={`text-xl font-bold font-mono ${valueColor}`}>{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  );
}

/* ── Move button ────────────────────────────────────────── */

function MoveButton({
  move,
  isSelected,
  isPlayerMove,
  onClick,
}: {
  move: MoveEval;
  isSelected: boolean;
  isPlayerMove: boolean;
  onClick: () => void;
}) {
  const icon = classIcon(move.classification);
  const color = classColor(move.classification);
  const isNonNormal = move.classification !== "normal" && move.classification !== "good";

  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded text-sm font-mono transition-all ${
        isSelected
          ? "bg-green-600/30 text-white ring-1 ring-green-500/50"
          : isPlayerMove
            ? "text-zinc-200 hover:bg-zinc-700/50"
            : "text-zinc-500 hover:bg-zinc-700/30"
      } ${isNonNormal && !isSelected ? classBg(move.classification).split(" ")[0] : ""}`}
    >
      {move.san}
      {icon && <span className={`ml-0.5 text-xs ${color}`}>{icon}</span>}
    </button>
  );
}

/* ── Main component ─────────────────────────────────────── */

export default function AnalysisCard({ analysis }: AnalysisCardProps) {
  const [selectedPly, setSelectedPly] = useState<number | null>(null);

  // Compute the FEN for the selected move
  const selectedFen = useMemo(() => {
    if (selectedPly === null) {
      // Show starting position
      return "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    }

    const move = analysis.moves.find((m) => m.ply === selectedPly);
    if (!move) return "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    // move.fen is the position BEFORE the move; apply the move to show position AFTER
    try {
      const chess = new Chess(move.fen);
      chess.move(move.san);
      return chess.fen();
    } catch {
      return move.fen;
    }
  }, [selectedPly, analysis.moves]);

  const selectedMove = analysis.moves.find((m) => m.ply === selectedPly) || null;

  // Group moves into pairs: (white, black)
  const movePairs = useMemo(() => {
    const pairs: { num: number; white?: MoveEval; black?: MoveEval }[] = [];
    for (const move of analysis.moves) {
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
  }, [analysis.moves]);

  // Navigation
  const plies = analysis.moves.map((m) => m.ply);
  const minPly = plies.length > 0 ? plies[0] : 1;
  const maxPly = plies.length > 0 ? plies[plies.length - 1] : 1;

  function goFirst() { setSelectedPly(null); }
  function goPrev() {
    if (selectedPly === null) return;
    if (selectedPly <= minPly) { setSelectedPly(null); return; }
    const idx = plies.indexOf(selectedPly);
    if (idx > 0) setSelectedPly(plies[idx - 1]);
  }
  function goNext() {
    if (selectedPly === null) { setSelectedPly(minPly); return; }
    const idx = plies.indexOf(selectedPly);
    if (idx < plies.length - 1) setSelectedPly(plies[idx + 1]);
  }
  function goLast() { setSelectedPly(maxPly); }

  const resultColor =
    analysis.result === "1-0"
      ? analysis.playerColor === "white" ? "text-green-400" : "text-red-400"
      : analysis.result === "0-1"
        ? analysis.playerColor === "black" ? "text-green-400" : "text-red-400"
        : "text-yellow-400";

  const resultText =
    analysis.result === "1-0"
      ? analysis.playerColor === "white" ? "You won" : "You lost"
      : analysis.result === "0-1"
        ? analysis.playerColor === "black" ? "You won" : "You lost"
        : "Draw";

  return (
    <div className="space-y-6">
      {/* Result banner */}
      <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
        <div className={`text-2xl font-bold ${resultColor}`}>{resultText}</div>
        <p className="mt-1 text-sm text-zinc-400">
          vs {analysis.opponentUsername}
          {analysis.opponentFideEstimate && ` (~${analysis.opponentFideEstimate} FIDE)`}
          {" · "}{analysis.opening}
          {" · "}{analysis.totalMoves} moves
          {" · "}{analysis.summary.accuracy}% accuracy
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label="Accuracy" value={`${analysis.summary.accuracy}%`} />
        <StatBox label="Avg CPL" value={`${analysis.summary.averageCentipawnLoss}`} />
        <StatBox
          label="Blunders"
          value={`${analysis.summary.blunders}`}
          highlight={analysis.summary.blunders > 0 ? "red" : undefined}
        />
        <StatBox
          label="Mistakes"
          value={`${analysis.summary.mistakes}`}
          highlight={analysis.summary.mistakes > 0 ? "yellow" : undefined}
        />
      </div>

      {/* Interactive Board + Move List */}
      <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Board */}
          <div className="flex-shrink-0">
            <div className="w-[280px] sm:w-[320px] mx-auto lg:mx-0">
              <Chessboard
                options={{
                  position: selectedFen,
                  boardOrientation: analysis.playerColor,
                  allowDragging: false,
                  boardStyle: {
                    borderRadius: "4px",
                  },
                  darkSquareStyle: { backgroundColor: "#779952" },
                  lightSquareStyle: { backgroundColor: "#edeed1" },
                }}
              />
            </div>

            {/* Navigation buttons */}
            <div className="flex justify-center gap-2 mt-3">
              <button
                onClick={goFirst}
                className="rounded px-3 py-1.5 text-sm bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
              >
                ⏮
              </button>
              <button
                onClick={goPrev}
                className="rounded px-3 py-1.5 text-sm bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
              >
                ◀
              </button>
              <button
                onClick={goNext}
                className="rounded px-3 py-1.5 text-sm bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
              >
                ▶
              </button>
              <button
                onClick={goLast}
                className="rounded px-3 py-1.5 text-sm bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
              >
                ⏭
              </button>
            </div>

            {/* Selected move info */}
            {selectedMove && (
              <div className={`mt-3 rounded-lg border p-3 text-sm ${classBg(selectedMove.classification)}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-zinc-300">
                    {Math.ceil(selectedMove.ply / 2)}.
                    {selectedMove.ply % 2 === 0 ? ".." : ""}{" "}
                    <span className="font-semibold text-white">{selectedMove.san}</span>
                    <span className={`ml-1 ${classColor(selectedMove.classification)}`}>
                      {classIcon(selectedMove.classification)}
                    </span>
                  </span>
                  <span className={`text-xs font-medium ${classColor(selectedMove.classification)}`}>
                    {classLabel(selectedMove.classification)}
                  </span>
                </div>
                {selectedMove.classification !== "normal" &&
                  selectedMove.classification !== "good" &&
                  selectedMove.classification !== "great" && (
                    <div className="mt-2 text-xs text-zinc-400">
                      Best was{" "}
                      <span className="font-mono text-green-400">
                        {selectedMove.bestMoveSan || selectedMove.bestMove}
                      </span>
                      <span className="ml-2 text-zinc-500">
                        (eval {selectedMove.eval > 0 ? "+" : ""}
                        {(selectedMove.eval / 100).toFixed(1)}, delta{" "}
                        {selectedMove.evalDelta > 0 ? "+" : ""}
                        {(selectedMove.evalDelta / 100).toFixed(1)})
                      </span>
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* Move list */}
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-500 uppercase tracking-wide mb-2">
              Moves
            </div>
            <div className="max-h-[420px] overflow-y-auto pr-1 space-y-0.5 scrollbar-thin">
              {movePairs.map((pair) => (
                <div key={pair.num} className="flex items-center gap-1">
                  <span className="w-7 text-right text-xs text-zinc-600 font-mono shrink-0">
                    {pair.num}.
                  </span>
                  <div className="flex gap-1">
                    {pair.white && (
                      <MoveButton
                        move={pair.white}
                        isSelected={selectedPly === pair.white.ply}
                        isPlayerMove={analysis.playerColor === "white"}
                        onClick={() => setSelectedPly(pair.white!.ply)}
                      />
                    )}
                    {pair.black && (
                      <MoveButton
                        move={pair.black}
                        isSelected={selectedPly === pair.black.ply}
                        isPlayerMove={analysis.playerColor === "black"}
                        onClick={() => setSelectedPly(pair.black!.ply)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Coaching narrative */}
      <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
        <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-3">
          Coach&apos;s Notes
        </h3>
        <p className="text-zinc-300 leading-relaxed">{analysis.coachingNarrative}</p>
      </div>

      {/* Key moments */}
      {analysis.keyMoments.length > 0 && (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
          <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-4">
            Key Moments
          </h3>
          <div className="space-y-3">
            {analysis.keyMoments.map((moment, i) => {
              // Find the ply for this key moment so we can jump to it
              const ply = analysis.moves.find(
                (m) => Math.ceil(m.ply / 2) === moment.moveNum
              )?.ply;

              return (
                <button
                  key={i}
                  onClick={() => ply && setSelectedPly(ply)}
                  className="flex w-full items-start gap-3 rounded-lg bg-zinc-900/50 p-3 text-left hover:bg-zinc-900/80 transition-colors"
                >
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-sm text-zinc-500 w-8">
                      #{moment.moveNum}
                    </span>
                    <EvalBar value={moment.eval} />
                  </div>
                  <p className="flex-1 text-sm text-zinc-300">
                    {moment.description}
                  </p>
                  <TagBadge tag={moment.tag} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

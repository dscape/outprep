/**
 * Shared analysis sub-components and helpers.
 * Used by both AnalysisCard (bot-game review) and GameReplay (OTB game replay).
 */

import type { MoveEval } from "@/lib/types";

/* ── Classification helpers ─────────────────────────────── */

export function classColor(c: MoveEval["classification"]): string {
  switch (c) {
    case "blunder":    return "text-red-400";
    case "mistake":    return "text-yellow-400";
    case "inaccuracy": return "text-orange-400";
    case "great":      return "text-cyan-400";
    case "good":       return "text-green-400";
    default:           return "text-zinc-400";
  }
}

export function classBg(c: MoveEval["classification"]): string {
  switch (c) {
    case "blunder":    return "bg-red-500/20 border-red-500/30";
    case "mistake":    return "bg-yellow-500/20 border-yellow-500/30";
    case "inaccuracy": return "bg-orange-500/20 border-orange-500/30";
    case "great":      return "bg-cyan-500/20 border-cyan-500/30";
    case "good":       return "bg-green-500/20 border-green-500/30";
    default:           return "bg-zinc-800/50 border-zinc-700/30";
  }
}

export function classIcon(c: MoveEval["classification"]): string {
  switch (c) {
    case "blunder":    return "??";
    case "mistake":    return "?";
    case "inaccuracy": return "?!";
    case "great":      return "!!";
    case "good":       return "!";
    default:           return "";
  }
}

export function classLabel(c: MoveEval["classification"]): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export function isErrorMove(move: MoveEval): boolean {
  return (
    move.classification === "blunder" ||
    move.classification === "mistake" ||
    move.classification === "inaccuracy"
  );
}

/* ── FullEvalBar ────────────────────────────────────────── */

export function FullEvalBar({
  evalCp,
  orientation,
}: {
  evalCp: number;
  orientation: "white" | "black";
}) {
  const clamped = Math.max(-1000, Math.min(1000, evalCp));
  const whitePct = 50 + (clamped / 1000) * 50;

  let evalText: string;
  if (Math.abs(evalCp) >= 29000) {
    const mateIn =
      evalCp > 0
        ? Math.ceil((30000 - evalCp) / 2)
        : Math.ceil((30000 + evalCp) / 2);
    evalText = `M${mateIn}`;
  } else {
    evalText = `${evalCp > 0 ? "+" : ""}${(evalCp / 100).toFixed(1)}`;
  }

  const displayWhitePct =
    orientation === "white" ? whitePct : 100 - whitePct;

  return (
    <div className="flex flex-col items-center gap-1 w-7 flex-shrink-0">
      <span className="text-[10px] font-mono text-zinc-400 leading-none">
        {evalText}
      </span>
      <div className="flex-1 w-4 rounded-sm overflow-hidden flex flex-col min-h-[200px]">
        <div
          className="bg-zinc-600 transition-all duration-300"
          style={{ height: `${100 - displayWhitePct}%` }}
        />
        <div
          className="bg-white transition-all duration-300"
          style={{ height: `${displayWhitePct}%` }}
        />
      </div>
    </div>
  );
}

/* ── MoveButton ─────────────────────────────────────────── */

export function MoveButton({
  move,
  isSelected,
  isPlayerMove,
  onClick,
}: {
  move: MoveEval;
  isSelected: boolean;
  isPlayerMove?: boolean;
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

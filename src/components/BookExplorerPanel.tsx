"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { lookupTrie } from "@outprep/engine";
import type { OpeningTrie, TrieNode } from "@outprep/engine";

interface BookExplorerPanelProps {
  whiteTrie: OpeningTrie | null;
  blackTrie: OpeningTrie | null;
  fen: string;
  onClose: () => void;
  /** Current half-move count (0 = starting position, before any move) */
  plyCount?: number;
  /** Move history in SAN notation (e.g. ["e4", "e5", "Nf3"]) */
  moveHistory?: string[];
}

function MoveRow({
  san,
  count,
  winRate,
  maxCount,
}: {
  san: string;
  count: number;
  winRate: number;
  maxCount: number;
}) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const barColor =
    winRate > 0.55
      ? "bg-green-500"
      : winRate < 0.45
        ? "bg-red-400"
        : "bg-orange-400";

  return (
    <div className="flex items-center gap-2 py-1.5 px-3 hover:bg-zinc-800/30 transition-colors">
      <span className="font-mono text-sm text-white w-12 shrink-0">{san}</span>
      <div className="flex-1 h-4 bg-zinc-800 rounded-sm overflow-hidden relative">
        <div
          className={`h-full ${barColor} rounded-sm transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs text-zinc-400 w-14 text-right shrink-0">
        {count.toLocaleString()}
      </span>
    </div>
  );
}

/** Format move history as chess notation (e.g. "1.e4 e5 2.Nf3 Nc6") */
function formatMoveHistory(moves: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) parts.push(`${Math.floor(i / 2) + 1}.${moves[i]}`);
    else parts.push(moves[i]);
  }
  return parts.join(" ");
}

export default function BookExplorerPanel({
  whiteTrie,
  blackTrie,
  fen,
  onClose,
  plyCount = 0,
  moveHistory = [],
}: BookExplorerPanelProps) {
  const activeTrie = useMemo(() => {
    const sideToMove = fen.split(" ")[1];
    return sideToMove === "w" ? whiteTrie : blackTrie;
  }, [whiteTrie, blackTrie, fen]);

  const node = useMemo<TrieNode | null>(() => {
    if (!activeTrie) return null;
    return lookupTrie(activeTrie, fen);
  }, [activeTrie, fen]);

  const trieSize = useMemo(() => {
    return Object.keys(whiteTrie || {}).length + Object.keys(blackTrie || {}).length;
  }, [whiteTrie, blackTrie]);

  const maxCount = useMemo(() => {
    if (!node || node.moves.length === 0) return 0;
    return node.moves[0].count; // already sorted descending
  }, [node]);

  // Resizable width
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return 280;
    return parseInt(localStorage.getItem("book-panel-width") || "280", 10);
  });
  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(220, Math.min(500, startWidth + (ev.clientX - startX)));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      localStorage.setItem("book-panel-width", String(widthRef.current));
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div
      className="fixed inset-y-0 left-0 z-50 flex flex-col bg-zinc-900 border-r border-zinc-700 shadow-2xl"
      style={{ width: `${width}px` }}
    >
      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-green-500/50 active:bg-green-500/70 z-50"
        onMouseDown={startResize}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 shrink-0">
        <span className="text-[10px] font-mono text-zinc-500 tracking-widest">
          OPENING BOOK
        </span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-sm px-1"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {!whiteTrie && !blackTrie ? (
          <div className="px-3 py-4 text-xs text-zinc-600">
            No opening book loaded.
          </div>
        ) : node ? (
          <>
            {/* Stats */}
            <div className="px-3 py-2 border-b border-zinc-800 text-[10px] text-zinc-500 font-mono flex justify-between">
              <span>{node.totalGames} games</span>
              <span>{node.moves.length} moves</span>
            </div>

            {/* Moves list */}
            <div className="py-1">
              {node.moves.map((m) => (
                <MoveRow
                  key={m.uci}
                  san={m.san}
                  count={m.count}
                  winRate={m.winRate}
                  maxCount={maxCount}
                />
              ))}
            </div>
          </>
        ) : plyCount === 0 ? (
          <div className="px-3 py-4 text-xs text-zinc-500">
            Play the first move to see book
          </div>
        ) : (
          <div className="px-3 py-4 text-xs text-zinc-600">
            <div className="text-zinc-500 mb-1">Out of book</div>
            {moveHistory.length > 0 && (
              <div className="font-mono text-zinc-500 mb-2">
                {formatMoveHistory(moveHistory)}
              </div>
            )}
            No games in the profiled player&apos;s history reach this position.
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-zinc-700 text-[10px] text-zinc-600 font-mono shrink-0">
        {trieSize} positions in book
      </div>
    </div>
  );
}

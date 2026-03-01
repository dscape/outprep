"use client";

import { useState, useMemo } from "react";
import { OpeningStats } from "@/lib/types";
import type { GameForDrilldown } from "@/lib/game-helpers";

interface OpeningCoverage {
  analyzed: number;
  total: number;
}

interface OpeningsTabProps {
  white: OpeningStats[];
  black: OpeningStats[];
  games?: GameForDrilldown[];
  onAnalyzeGame?: (game: GameForDrilldown) => void;
  onRequestGames?: () => void;
  loadingGames?: boolean;
  coverageByOpening?: Map<string, OpeningCoverage>;
}

function WDLBar({ win, draw, loss }: { win: number; draw: number; loss: number }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      <div className="bg-green-500" style={{ width: `${win}%` }} />
      <div className="bg-zinc-400" style={{ width: `${draw}%` }} />
      <div className="bg-red-500" style={{ width: `${loss}%` }} />
    </div>
  );
}

function ResultBadge({ result, playerColor }: { result: string; playerColor: "white" | "black" }) {
  const isWin =
    (result === "1-0" && playerColor === "white") ||
    (result === "0-1" && playerColor === "black");
  const isLoss =
    (result === "1-0" && playerColor === "black") ||
    (result === "0-1" && playerColor === "white");

  if (isWin) return <span className="text-green-400 font-medium">Win</span>;
  if (isLoss) return <span className="text-red-400 font-medium">Loss</span>;
  return <span className="text-zinc-400 font-medium">Draw</span>;
}

function CoverageBadge({ coverage }: { coverage: OpeningCoverage }) {
  if (coverage.analyzed === 0) {
    return (
      <span className="text-[10px] text-zinc-600" title="No games in this opening have engine analysis">
        no evals
      </span>
    );
  }
  if (coverage.analyzed >= coverage.total) {
    return (
      <span className="text-[10px] text-green-500/70" title="All games in this opening have engine analysis">
        ✓
      </span>
    );
  }
  return (
    <span
      className="text-[10px] text-zinc-500"
      title={`${coverage.analyzed} of ${coverage.total} games have engine analysis`}
    >
      {coverage.analyzed}/{coverage.total}
    </span>
  );
}

export default function OpeningsTab({
  white,
  black,
  games,
  onAnalyzeGame,
  onRequestGames,
  loadingGames,
  coverageByOpening,
}: OpeningsTabProps) {
  const [color, setColor] = useState<"white" | "black">("white");
  const [expandedOpening, setExpandedOpening] = useState<string | null>(null);
  const openings = color === "white" ? white : black;

  const isClickable = !!(games || onRequestGames);
  const hasCoverage = !!coverageByOpening;

  // Index games by opening family + color for quick lookup
  const gamesByOpening = useMemo(() => {
    if (!games) return null;
    const map = new Map<string, GameForDrilldown[]>();
    for (const g of games) {
      // Match games where the player played this color
      if (g.playerColor !== color) continue;
      const key = g.openingFamily;
      const arr = map.get(key) || [];
      arr.push(g);
      map.set(key, arr);
    }
    return map;
  }, [games, color]);

  // Calculate overall coverage stats for nudge banner
  const coverageStats = useMemo(() => {
    if (!coverageByOpening) return null;
    let totalAnalyzed = 0;
    let totalGames = 0;
    for (const [, c] of coverageByOpening) {
      totalAnalyzed += c.analyzed;
      totalGames += c.total;
    }
    return { analyzed: totalAnalyzed, total: totalGames };
  }, [coverageByOpening]);

  const handleRowClick = (openingName: string) => {
    if (!isClickable) return;

    // If games aren't loaded yet, request them and store which opening to expand
    if (!games && onRequestGames) {
      onRequestGames();
      setExpandedOpening(openingName);
      return;
    }

    setExpandedOpening((prev) => (prev === openingName ? null : openingName));
  };

  // Reset expanded state when switching colors
  const handleColorChange = (c: "white" | "black") => {
    setColor(c);
    setExpandedOpening(null);
  };

  // Column count for colSpan calculation
  const colCount = (isClickable ? 1 : 0) + 5 + (hasCoverage ? 1 : 0);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => handleColorChange("white")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            color === "white"
              ? "bg-white text-zinc-900"
              : "bg-zinc-800 text-zinc-400 hover:text-white"
          }`}
        >
          As White
        </button>
        <button
          onClick={() => handleColorChange("black")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            color === "black"
              ? "bg-zinc-600 text-white"
              : "bg-zinc-800 text-zinc-400 hover:text-white"
          }`}
        >
          As Black
        </button>
      </div>

      {/* Coverage nudge banner */}
      {coverageStats && coverageStats.total > 0 && coverageStats.analyzed < coverageStats.total * 0.5 && (
        <div className="mb-4 rounded-lg border border-zinc-700/40 bg-zinc-800/30 px-3 py-2 text-xs text-zinc-400">
          Only {coverageStats.analyzed} of {coverageStats.total} games have engine analysis.
          Run a Quick Scan for more accurate data.
        </div>
      )}

      {openings.length === 0 ? (
        <p className="text-sm text-zinc-500">No opening data available.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-left text-zinc-400">
                {isClickable && <th className="pb-2 pr-2 w-6 font-medium" />}
                <th className="pb-2 pr-4 font-medium">ECO</th>
                <th className="pb-2 pr-4 font-medium">Opening</th>
                <th className="pb-2 pr-4 font-medium text-right">Games</th>
                <th className="pb-2 pr-4 font-medium text-right">Freq</th>
                <th className="pb-2 pr-4 font-medium min-w-[120px]">W / D / L</th>
                {hasCoverage && (
                  <th className="pb-2 font-medium text-right" title="Engine analysis coverage">Evals</th>
                )}
              </tr>
            </thead>
            <tbody>
              {openings.map((op) => {
                const isExpanded = expandedOpening === op.name;
                const matchingGames = gamesByOpening?.get(op.name) || [];
                const coverage = coverageByOpening?.get(op.name);

                return (
                  <OpeningRow
                    key={`${op.eco}-${op.name}`}
                    op={op}
                    isExpanded={isExpanded}
                    isClickable={isClickable}
                    loadingGames={!!loadingGames && isExpanded && !games}
                    matchingGames={matchingGames}
                    onToggle={() => handleRowClick(op.name)}
                    onAnalyzeGame={onAnalyzeGame}
                    coverage={coverage}
                    hasCoverageColumn={hasCoverage}
                    colCount={colCount}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OpeningRow({
  op,
  isExpanded,
  isClickable,
  loadingGames,
  matchingGames,
  onToggle,
  onAnalyzeGame,
  coverage,
  hasCoverageColumn,
  colCount,
}: {
  op: OpeningStats;
  isExpanded: boolean;
  isClickable: boolean;
  loadingGames: boolean;
  matchingGames: GameForDrilldown[];
  onToggle: () => void;
  onAnalyzeGame?: (game: GameForDrilldown) => void;
  coverage?: OpeningCoverage;
  hasCoverageColumn: boolean;
  colCount: number;
}) {
  return (
    <>
      <tr
        onClick={isClickable ? onToggle : undefined}
        className={`border-b text-zinc-300 transition-colors ${
          isClickable ? "cursor-pointer hover:bg-zinc-800/50" : ""
        } ${
          isExpanded
            ? "border-zinc-700 bg-zinc-800/30"
            : "border-zinc-800"
        }`}
      >
        {isClickable && (
          <td className="py-2 pr-2 text-zinc-500 text-xs">
            {isExpanded ? "▼" : "▶"}
          </td>
        )}
        <td className="py-2 pr-4 font-mono text-green-400">{op.eco}</td>
        <td className="py-2 pr-4 max-w-[200px] truncate">{op.name}</td>
        <td className="py-2 pr-4 text-right font-mono">{op.games}</td>
        <td className="py-2 pr-4 text-right font-mono">{op.pct}%</td>
        <td className="py-2 pr-4">
          <div className="space-y-1">
            <WDLBar win={op.winRate} draw={op.drawRate} loss={op.lossRate} />
            <div className="flex justify-between text-xs text-zinc-500">
              <span className="text-green-400">{op.winRate}%</span>
              <span>{op.drawRate}%</span>
              <span className="text-red-400">{op.lossRate}%</span>
            </div>
          </div>
        </td>
        {hasCoverageColumn && (
          <td className="py-2 text-right">
            {coverage ? <CoverageBadge coverage={coverage} /> : null}
          </td>
        )}
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={colCount} className="p-0">
            <div className="border-l-2 border-green-500/40 bg-zinc-900/40 px-4 py-3 ml-2">
              {loadingGames ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <span className="animate-pulse">Loading games...</span>
                </div>
              ) : matchingGames.length === 0 ? (
                <p className="text-sm text-zinc-500">No individual games available for this opening.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-500 text-xs">
                      <th className="pb-1.5 pr-3 font-medium">#</th>
                      <th className="pb-1.5 pr-3 font-medium">Opponent</th>
                      <th className="pb-1.5 pr-3 font-medium">Result</th>
                      <th className="pb-1.5 pr-3 font-medium">Date</th>
                      {onAnalyzeGame && (
                        <th className="pb-1.5 font-medium text-right" />
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {matchingGames.map((g, idx) => (
                      <tr
                        key={g.id}
                        className="border-t border-zinc-800/50 text-zinc-300"
                      >
                        <td className="py-1.5 pr-3 font-mono text-zinc-500 text-xs">
                          {idx + 1}
                        </td>
                        <td className="py-1.5 pr-3 truncate max-w-[150px]">
                          {g.opponent}
                        </td>
                        <td className="py-1.5 pr-3">
                          <ResultBadge result={g.result} playerColor={g.playerColor} />
                        </td>
                        <td className="py-1.5 pr-3 text-zinc-500 text-xs">
                          {g.date || "—"}
                        </td>
                        {onAnalyzeGame && (
                          <td className="py-1.5 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onAnalyzeGame(g);
                              }}
                              className="rounded bg-green-600/80 px-2.5 py-0.5 text-xs font-medium text-white transition-colors hover:bg-green-500"
                            >
                              Analyze
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

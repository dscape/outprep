"use client";

import { useState } from "react";
import type { ErrorProfile, StyleMetrics, MoveType } from "@outprep/engine";
import type { DebugMoveEntry } from "@/lib/debug-reasoning";
import { classifyMove } from "@/lib/debug-reasoning";

interface DebugPanelProps {
  entries: DebugMoveEntry[];
  onClose: () => void;
  errorProfile?: ErrorProfile | null;
  styleMetrics?: StyleMetrics | null;
}

const BADGE_STYLES: Record<string, string> = {
  green: "bg-green-600/20 border-green-500/30 text-green-400",
  red: "bg-red-600/20 border-red-500/30 text-red-400",
  orange: "bg-orange-600/20 border-orange-500/30 text-orange-400",
  yellow: "bg-yellow-600/20 border-yellow-500/30 text-yellow-400",
  zinc: "bg-zinc-700/50 border-zinc-600/30 text-zinc-400",
  blue: "bg-blue-600/20 border-blue-500/30 text-blue-400",
};

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${BADGE_STYLES[color] || BADGE_STYLES.zinc}`}
    >
      {label}
    </span>
  );
}

/* ── Move notation helpers ─────────────────────────────────── */

function movePrefix(ply: number): string {
  const moveNumber = Math.ceil(ply / 2);
  const isWhite = ply % 2 === 1;
  return isWhite ? `${moveNumber}.` : `${moveNumber}...`;
}

function moveTypeLabel(type: MoveType): { icon: string; label: string; color: string } {
  switch (type) {
    case "capture":
      return { icon: "⚔", label: "AGG", color: "text-orange-400" };
    case "check":
      return { icon: "⚡", label: "TAC", color: "text-blue-400" };
    case "quiet":
      return { icon: "◼", label: "POS", color: "text-zinc-500" };
  }
}

/* ── Bot Profile Section ─────────────────────────────────── */

function StyleBar({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const clampedValue = Math.max(0, Math.min(100, value));
  const barColor =
    clampedValue >= 70
      ? "bg-green-500"
      : clampedValue >= 40
        ? "bg-yellow-500"
        : "bg-zinc-500";

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-zinc-500 w-16 text-right shrink-0">
        {label}
      </span>
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all`}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
      <span className="text-[10px] text-zinc-400 w-6 text-right font-mono">
        {clampedValue}
      </span>
    </div>
  );
}

function BotProfileSection({
  errorProfile,
  styleMetrics,
}: {
  errorProfile?: ErrorProfile | null;
  styleMetrics?: StyleMetrics | null;
}) {
  const [expanded, setExpanded] = useState(true);

  if (!errorProfile && !styleMetrics) return null;

  // Show explanatory note if game counts differ
  const styleSample = styleMetrics?.sampleSize ?? 0;
  const errorSample = errorProfile?.gamesAnalyzed ?? 0;
  const showCountNote = styleSample > 0 && errorSample > 0 && styleSample !== errorSample;

  return (
    <div className="border-b border-zinc-700">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-mono text-zinc-500 tracking-wider hover:bg-zinc-800/30"
      >
        BOT PROFILE
        <span>{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Style metrics */}
          {styleMetrics && (
            <div className="space-y-1">
              <div className="text-[10px] text-zinc-600 font-mono mb-1">
                STYLE ({styleMetrics.sampleSize} games)
              </div>
              <StyleBar label="Aggression" value={styleMetrics.aggression} />
              <StyleBar label="Tactical" value={styleMetrics.tactical} />
              <StyleBar label="Positional" value={styleMetrics.positional} />
              <StyleBar label="Endgame" value={styleMetrics.endgame} />
            </div>
          )}

          {/* Error profile table */}
          {errorProfile && errorProfile.gamesAnalyzed > 0 && (
            <div>
              <div className="text-[10px] text-zinc-600 font-mono mb-1">
                ERROR RATES ({errorProfile.gamesAnalyzed} analyzed)
              </div>
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-zinc-600 border-b border-zinc-800">
                    <th className="text-left py-0.5 font-normal">Phase</th>
                    <th className="text-right py-0.5 font-normal">Err%</th>
                    <th className="text-right py-0.5 font-normal">Bldr%</th>
                    <th className="text-right py-0.5 font-normal">CPL</th>
                    <th className="text-right py-0.5 font-normal">Moves</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Opening", errorProfile.opening],
                      ["Middle", errorProfile.middlegame],
                      ["Endgame", errorProfile.endgame],
                    ] as const
                  ).map(([name, phase]) => (
                    <tr key={name} className="text-zinc-400">
                      <td className="py-0.5">{name}</td>
                      <td className="py-0.5 text-right font-mono">
                        {(phase.errorRate * 100).toFixed(1)}
                      </td>
                      <td className="py-0.5 text-right font-mono">
                        {(phase.blunderRate * 100).toFixed(1)}
                      </td>
                      <td className="py-0.5 text-right font-mono">
                        {Math.round(phase.avgCPL)}
                      </td>
                      <td className="py-0.5 text-right font-mono">
                        {phase.totalMoves}
                      </td>
                    </tr>
                  ))}
                  <tr className="text-zinc-300 border-t border-zinc-800 font-medium">
                    <td className="py-0.5">Overall</td>
                    <td className="py-0.5 text-right font-mono">
                      {(errorProfile.overall.errorRate * 100).toFixed(1)}
                    </td>
                    <td className="py-0.5 text-right font-mono">
                      {(errorProfile.overall.blunderRate * 100).toFixed(1)}
                    </td>
                    <td className="py-0.5 text-right font-mono">
                      {Math.round(errorProfile.overall.avgCPL)}
                    </td>
                    <td className="py-0.5 text-right font-mono">
                      {errorProfile.overall.totalMoves}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Explanatory note for different game counts */}
          {showCountNote && (
            <div className="text-[10px] text-zinc-600 italic">
              Style uses all games; error rates require engine analysis
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Candidate Table ─────────────────────────────────────── */

function CandidateTable({
  entry,
}: {
  entry: DebugMoveEntry;
}) {
  const candidates = entry.result.candidates;
  if (!candidates || candidates.length === 0) return null;

  const probs = entry.selectionProbabilities;
  const types = entry.candidateTypes;

  return (
    <table className="w-full text-xs mt-2">
      <thead>
        <tr className="text-zinc-500 border-b border-zinc-800">
          <th className="text-left py-1 font-normal">#</th>
          <th className="text-left py-1 font-normal">Move</th>
          <th className="text-left py-1 font-normal">Type</th>
          <th className="text-right py-1 font-normal">Score</th>
          <th className="text-right py-1 font-normal">Prob</th>
          <th className="text-right py-1 font-normal">D</th>
        </tr>
      </thead>
      <tbody>
        {candidates.map((c, i) => {
          const isSelected = c.uci === entry.result.uci;
          const scoreStr = c.score >= 0 ? `+${c.score}` : `${c.score}`;
          const prob = probs[i] !== undefined ? `${(probs[i] * 100).toFixed(1)}%` : "—";
          const type = types[i] ? moveTypeLabel(types[i]) : null;
          return (
            <tr
              key={c.uci}
              className={
                isSelected
                  ? "bg-green-500/10 text-green-300"
                  : "text-zinc-400"
              }
            >
              <td className="py-0.5">{i + 1}</td>
              <td className="py-0.5 font-mono">{c.san || c.uci}</td>
              <td className="py-0.5">
                {type && (
                  <span className={`text-[10px] ${type.color}`}>
                    {type.icon} {type.label}
                  </span>
                )}
              </td>
              <td className="py-0.5 text-right font-mono">{scoreStr}</td>
              <td className="py-0.5 text-right font-mono">{prob}</td>
              <td className="py-0.5 text-right">{c.depth}</td>
            </tr>
          );
        })}
        {/* Show Stockfish best if it differs from all candidates */}
        {entry.stockfishBestMove &&
          !candidates.some((c) => c.uci === entry.stockfishBestMove) && (
            <tr className="text-blue-400 border-t border-zinc-800/50">
              <td className="py-0.5">SF</td>
              <td className="py-0.5 font-mono">
                {entry.stockfishBestMoveSan || entry.stockfishBestMove}
              </td>
              <td className="py-0.5"></td>
              <td className="py-0.5 text-right font-mono">
                {entry.stockfishEval != null ? formatEval(entry.stockfishEval) : "?"}
              </td>
              <td className="py-0.5 text-right font-mono">—</td>
              <td className="py-0.5 text-right">d12</td>
            </tr>
          )}
      </tbody>
    </table>
  );
}

/* ── Stockfish Comparison Section ────────────────────────── */

function StockfishComparison({ entry }: { entry: DebugMoveEntry }) {
  if (entry.result.source === "book") return null;

  // No Stockfish data yet
  if (entry.stockfishEval === null) {
    return (
      <div className="text-[10px] text-zinc-600 italic mt-1">
        Analyzing position...
      </div>
    );
  }

  const { label, color } = classifyMove(entry);

  return (
    <div className="mt-2 space-y-1 text-xs">
      {/* Bot's move */}
      <div className="flex items-center gap-2">
        <span className="text-zinc-500 w-14 shrink-0">Bot:</span>
        <span className="font-mono text-white">
          {entry.moveSan}
        </span>
        {entry.evalAfter != null && (
          <span className="text-zinc-500 font-mono">
            ({formatEval(-entry.evalAfter)})
          </span>
        )}
      </div>

      {/* Stockfish best */}
      <div className="flex items-center gap-2">
        <span className="text-zinc-500 w-14 shrink-0">SF best:</span>
        <span className="font-mono text-blue-400">
          {entry.stockfishBestMoveSan || entry.stockfishBestMove}
        </span>
        <span className="text-zinc-500 font-mono">
          ({formatEval(entry.stockfishEval)})
        </span>
      </div>

      {/* CPL + classification */}
      {entry.trueCpLoss !== null && (
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 w-14 shrink-0">CPL:</span>
          <span className="font-mono text-white">{entry.trueCpLoss}cp</span>
          <Badge label={label} color={color} />
        </div>
      )}
    </div>
  );
}

/* ── Latest Move Card ────────────────────────────────────── */

function LatestMoveCard({ entry }: { entry: DebugMoveEntry }) {
  const { label, color } = classifyMove(entry);
  const sourceBadge =
    entry.result.source === "book" ? (
      <Badge label="BOOK" color="green" />
    ) : (
      <Badge label="ENGINE" color="zinc" />
    );

  return (
    <div className="border-b border-zinc-700 px-3 py-3">
      {/* Move + badges row */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs font-mono text-zinc-500">
          {movePrefix(entry.ply)}
        </span>
        <span className="text-sm font-mono text-white">
          {entry.moveSan}
        </span>
        {sourceBadge}
        <Badge label={entry.result.phase.toUpperCase()} color="zinc" />
        <Badge label={label} color={color} />
      </div>

      {/* Decision path */}
      <div className="text-[10px] text-zinc-500 space-y-0.5">
        <div>
          Skill: {entry.result.dynamicSkill} | Temp: {entry.temperature.toFixed(2)} | Think: {Math.round(entry.result.thinkTimeMs)}ms
        </div>
        {entry.selectedRank > 0 && entry.result.candidates && entry.result.candidates.length > 1 && (
          <div>
            Picked #{entry.selectedRank} of {entry.result.candidates.length} candidates
            {entry.cpLoss > 0 && ` (${entry.cpLoss}cp vs best)`}
          </div>
        )}
      </div>

      {/* Stockfish comparison */}
      <StockfishComparison entry={entry} />

      {/* Candidate table */}
      <CandidateTable entry={entry} />
    </div>
  );
}

/* ── History Row ─────────────────────────────────────────── */

function MoveHistoryRow({ entry }: { entry: DebugMoveEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { label, color } = classifyMove(entry);

  return (
    <div className="border-b border-zinc-800/50">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 py-1.5 text-xs hover:bg-zinc-800/30 transition-colors"
      >
        <span className="text-zinc-600 w-10 text-right shrink-0 font-mono">
          {movePrefix(entry.ply)}
        </span>
        <span className="font-mono text-zinc-300">
          {entry.moveSan}
        </span>
        <Badge label={label} color={color} />
        {entry.trueCpLoss !== null && entry.trueCpLoss > 0 && (
          <span className="text-[10px] font-mono text-zinc-600">
            {entry.trueCpLoss}cp
          </span>
        )}
        <span className="ml-auto text-zinc-600">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div className="pl-12 pb-2">
          <StockfishComparison entry={entry} />
          <CandidateTable entry={entry} />
          <pre className="mt-1 text-[10px] text-zinc-500 font-mono whitespace-pre-wrap leading-relaxed">
            {entry.reasoning}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Main Panel ──────────────────────────────────────────── */

export default function DebugPanel({
  entries,
  onClose,
  errorProfile,
  styleMetrics,
}: DebugPanelProps) {
  const latest = entries[entries.length - 1] ?? null;
  const history = entries.slice(0, -1).reverse();

  return (
    <div className="fixed inset-y-0 right-0 w-80 z-50 flex flex-col bg-zinc-900 border-l border-zinc-700 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 shrink-0">
        <span className="text-[10px] font-mono text-zinc-500 tracking-widest">
          DEBUG PANEL
        </span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-sm px-1"
        >
          ✕
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Bot Profile */}
        <BotProfileSection
          errorProfile={errorProfile}
          styleMetrics={styleMetrics}
        />

        {/* Latest move */}
        {latest ? (
          <LatestMoveCard entry={latest} />
        ) : (
          <div className="px-3 py-4 text-xs text-zinc-600">
            Waiting for bot move...
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="px-3 py-1">
            <div className="text-[10px] text-zinc-600 font-mono tracking-wider mb-1">
              HISTORY
            </div>
            {history.map((entry) => (
              <MoveHistoryRow key={entry.ply} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────── */

function formatEval(cp: number | null): string {
  if (cp === null) return "?";
  const sign = cp >= 0 ? "+" : "";
  return `${sign}${(cp / 100).toFixed(2)}`;
}

"use client";

import { GameAnalysis, MomentTag } from "@/lib/types";

interface AnalysisCardProps {
  analysis: GameAnalysis;
}

function TagBadge({ tag }: { tag: MomentTag }) {
  const styles: Record<MomentTag, string> = {
    "EXPECTED": "bg-zinc-600/30 text-zinc-300 border-zinc-500/30",
    "PREP HIT": "bg-green-600/20 text-green-400 border-green-500/30",
    "YOUR ERROR": "bg-red-600/20 text-red-400 border-red-500/30",
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
  // Normalize eval to -1 to 1 range for display
  const normalized = Math.max(-1, Math.min(1, value / 300));
  const pct = ((normalized + 1) / 2) * 100;

  return (
    <div className="flex h-3 w-16 overflow-hidden rounded-sm bg-zinc-800">
      <div className="bg-white" style={{ width: `${pct}%` }} />
      <div className="bg-zinc-600" style={{ width: `${100 - pct}%` }} />
    </div>
  );
}

export default function AnalysisCard({ analysis }: AnalysisCardProps) {
  const resultColor =
    analysis.result === "1-0"
      ? analysis.playerColor === "white"
        ? "text-green-400"
        : "text-red-400"
      : analysis.result === "0-1"
        ? analysis.playerColor === "black"
          ? "text-green-400"
          : "text-red-400"
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
        <StatBox label="Blunders" value={`${analysis.summary.blunders}`} highlight={analysis.summary.blunders > 0 ? "red" : undefined} />
        <StatBox label="Mistakes" value={`${analysis.summary.mistakes}`} highlight={analysis.summary.mistakes > 0 ? "yellow" : undefined} />
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
            {analysis.keyMoments.map((moment, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg bg-zinc-900/50 p-3"
              >
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-sm text-zinc-500 w-8">
                    #{moment.moveNum}
                  </span>
                  <EvalBar value={moment.eval} />
                </div>
                <p className="flex-1 text-sm text-zinc-300">{moment.description}</p>
                <TagBadge tag={moment.tag} />
              </div>
            ))}
          </div>
        </div>
      )}
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
  const valueColor = highlight === "red"
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

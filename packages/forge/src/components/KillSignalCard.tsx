"use client";

import type { KillSignalRecord } from "@/lib/forge-types";

const oracleTypeStyles: Record<string, string> = {
  adversarial: "bg-red-900/50 text-red-400 border-red-800",
  confirmatory: "bg-emerald-900/50 text-emerald-400 border-emerald-800",
  none: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

function rateColor(rate: number): string {
  if (rate > 0.3) return "text-emerald-400";
  if (rate >= 0.1) return "text-amber-400";
  return "text-red-400";
}

export function KillSignalCard({
  killSignal,
}: {
  killSignal: KillSignalRecord;
}) {
  const date = new Date(killSignal.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="rounded-lg border border-red-900/50 bg-zinc-900 p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 mr-3">
          <p className="text-sm font-medium text-zinc-100">
            {killSignal.description}
          </p>
          <p className="text-xs text-zinc-500 mt-1">{date}</p>
        </div>
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${oracleTypeStyles[killSignal.firstOracleType]}`}
        >
          {killSignal.firstOracleType}
        </span>
      </div>

      <div className="space-y-3 mt-4">
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-1">
            Abandonment Point
          </p>
          <p className="text-sm text-zinc-300">{killSignal.abandonmentPoint}</p>
        </div>

        <div>
          <p className="text-xs font-medium text-zinc-500 mb-1">Reason</p>
          <p className="text-sm text-zinc-300">{killSignal.reason}</p>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 border-t border-zinc-800">
          <div>
            <p className="text-xs text-zinc-500">Surprise Rate</p>
            <p
              className={`text-sm font-mono font-medium ${rateColor(killSignal.surpriseRateAtAbandonment)}`}
            >
              {(killSignal.surpriseRateAtAbandonment * 100).toFixed(0)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Experiments Completed</p>
            <p className="text-sm font-mono text-zinc-200">
              {killSignal.experimentsCompleted}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Hypothesis Set</p>
            <p className="text-sm font-mono text-zinc-400">
              {killSignal.hypothesisSetId.slice(0, 8)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

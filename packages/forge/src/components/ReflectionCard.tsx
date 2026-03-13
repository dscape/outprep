"use client";

import type { ReflectionCheckpoint } from "@/lib/forge-types";

function rateColor(rate: number): string {
  if (rate > 0.3) return "text-emerald-400";
  if (rate >= 0.1) return "text-amber-400";
  return "text-red-400";
}

export function ReflectionCard({
  reflection,
}: {
  reflection: ReflectionCheckpoint;
}) {
  const date = new Date(reflection.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-500">
            After Experiment #{reflection.afterExperimentNumber}
          </span>
          <span className="text-xs text-zinc-600">{date}</span>
        </div>
        <span
          className={`text-sm font-mono font-medium ${rateColor(reflection.currentSurpriseRate)}`}
        >
          {(reflection.currentSurpriseRate * 100).toFixed(0)}% surprise
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-1">Ruled Out</p>
          <p className="text-sm text-zinc-300">{reflection.ruledOut}</p>
        </div>

        <div>
          <p className="text-xs font-medium text-zinc-500 mb-1">
            Surprise Rate Analysis
          </p>
          <p className="text-sm text-zinc-300">
            {reflection.surpriseRateAnalysis}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-zinc-500 mb-1">
            Unexpected Result
          </p>
          <p className="text-sm text-zinc-300">
            {reflection.unexpectedResultDescription}
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";

import { Weakness } from "@/lib/types";

interface WeaknessesTabProps {
  weaknesses: Weakness[];
}

function SeverityBadge({ severity }: { severity: Weakness["severity"] }) {
  const colors = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    moderate: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    minor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };

  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${colors[severity]}`}
    >
      {severity}
    </span>
  );
}

export default function WeaknessesTab({ weaknesses }: WeaknessesTabProps) {
  if (weaknesses.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No significant weaknesses detected from the available game data.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {weaknesses.map((w, i) => (
        <div
          key={i}
          className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-medium text-white">{w.area}</h4>
                <SeverityBadge severity={w.severity} />
                {w.confidence === "low" && (
                  <span className="inline-block rounded-full border border-zinc-600/50 bg-zinc-700/30 px-2 py-0.5 text-xs text-zinc-500">
                    low data
                  </span>
                )}
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">
                {w.description}
              </p>
            </div>
          </div>
          <div className="mt-2 inline-block rounded bg-zinc-900 px-2 py-1 text-xs font-mono text-zinc-400">
            {w.stat}
          </div>
        </div>
      ))}
    </div>
  );
}

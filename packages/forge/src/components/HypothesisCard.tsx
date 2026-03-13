"use client";

import { useState } from "react";
import type {
  HypothesisSet,
  HypothesisLevel,
  KillSignalRecord,
} from "@/lib/forge-types";

const levelStyles: Record<HypothesisLevel, string> = {
  "continuous-a": "bg-blue-900/50 text-blue-400 border-blue-800",
  "continuous-b": "bg-amber-900/50 text-amber-400 border-amber-800",
  groundbreaking: "bg-purple-900/50 text-purple-400 border-purple-800",
};

const levelLabels: Record<HypothesisLevel, string> = {
  "continuous-a": "Continuous A",
  "continuous-b": "Continuous B",
  groundbreaking: "Groundbreaking",
};

export function HypothesisCard({
  hypothesisSet,
  killSignals,
}: {
  hypothesisSet: HypothesisSet;
  killSignals?: KillSignalRecord[];
}) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(hypothesisSet.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const relatedKills = killSignals?.filter(
    (k) => k.hypothesisSetId === hypothesisSet.id
  );

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-500">
            {hypothesisSet.id.slice(0, 8)}
          </span>
          <span className="text-xs text-zinc-600">{date}</span>
        </div>
        <span
          className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${levelStyles[hypothesisSet.committedLevel]}`}
        >
          committed: {levelLabels[hypothesisSet.committedLevel]}
        </span>
      </div>

      {/* Hypothesis grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {hypothesisSet.hypotheses.map((h, i) => {
          const isCommitted = h.level === hypothesisSet.committedLevel;
          return (
            <div
              key={i}
              className={`rounded-lg border p-3 ${
                isCommitted
                  ? "border-emerald-700 bg-emerald-900/20"
                  : "border-zinc-800 bg-zinc-800/30"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${levelStyles[h.level]}`}
                >
                  {levelLabels[h.level]}
                </span>
                {isCommitted && (
                  <span className="text-xs text-emerald-400 font-medium">
                    committed
                  </span>
                )}
              </div>
              <p className="text-sm text-zinc-200 mb-2">{h.statement}</p>
              <div className="space-y-1">
                <p className="text-xs text-zinc-500">Falsification</p>
                <p className="text-xs text-zinc-400">
                  {h.falsificationCriteria}
                </p>
              </div>
              <div className="mt-2">
                <p className="text-xs text-zinc-500">Est. Cost</p>
                <p className="text-xs font-mono text-zinc-400">
                  {h.estimatedCost}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Commitment details */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {expanded ? "Hide details" : "Show details"}
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-zinc-800 space-y-3">
          <div>
            <p className="text-xs font-medium text-zinc-500 mb-1">
              Commitment Rationale
            </p>
            <p className="text-sm text-zinc-300">
              {hypothesisSet.commitmentRationale}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500 mb-1">
              Cost of Being Wrong
            </p>
            <p className="text-sm text-zinc-300">
              {hypothesisSet.costOfBeingWrong}
            </p>
          </div>

          {relatedKills && relatedKills.length > 0 && (
            <div>
              <p className="text-xs font-medium text-red-400 mb-1">
                Kill Signals ({relatedKills.length})
              </p>
              <ul className="space-y-1">
                {relatedKills.map((k) => (
                  <li
                    key={k.id}
                    className="text-xs text-red-300 pl-3 relative"
                  >
                    <span className="absolute left-0 text-red-600">-</span>
                    {k.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

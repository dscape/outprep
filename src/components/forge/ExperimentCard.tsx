"use client";

import { useState } from "react";
import type { ExperimentRecord } from "@/lib/forge-types";
import { MetricDelta } from "./MetricDelta";
import { MarkdownContent } from "./MarkdownContent";

const conclusionStyles = {
  confirmed: "bg-emerald-900/50 text-emerald-400 border-emerald-800",
  refuted: "bg-red-900/50 text-red-400 border-red-800",
  partial: "bg-amber-900/50 text-amber-400 border-amber-800",
  inconclusive: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

const categoryStyles = {
  algorithm: "text-blue-400",
  parameter: "text-purple-400",
  architecture: "text-amber-400",
  data: "text-emerald-400",
};

export function ExperimentCard({ experiment, logContent }: { experiment: ExperimentRecord; logContent?: string }) {
  const [open, setOpen] = useState(false);
  const date = new Date(experiment.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const duration = experiment.evaluationDurationMs
    ? `${(experiment.evaluationDurationMs / 1000).toFixed(1)}s`
    : null;

  return (
    <div className="relative pl-8">
      {/* Timeline dot */}
      <div className="absolute left-0 top-2 w-4 h-4 rounded-full border-2 border-zinc-700 bg-zinc-900" />
      {/* Timeline line */}
      <div className="absolute left-[7px] top-6 bottom-0 w-0.5 bg-zinc-800" />

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 mb-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-zinc-500">
                #{experiment.number}
              </span>
              <span className={`text-xs ${categoryStyles[experiment.category]}`}>
                {experiment.category}
              </span>
              <span className="text-xs text-zinc-600">{date}</span>
              {duration && (
                <span className="text-xs text-zinc-600">{duration}</span>
              )}
            </div>
            <p className="text-sm font-medium text-zinc-200">
              {experiment.hypothesis}
            </p>
          </div>
          <span
            className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${conclusionStyles[experiment.conclusion]}`}
          >
            {experiment.conclusion}
          </span>
        </div>

        {/* Metric deltas */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          <MetricDelta
            label="Accuracy"
            value={experiment.delta.moveAccuracy}
            percentage
          />
          <MetricDelta
            label="Composite"
            value={experiment.delta.compositeScore}
          />
          <MetricDelta
            label="CPL KL"
            value={experiment.delta.cplKLDivergence}
            invert
          />
        </div>

        {/* Expandable details */}
        <button
          onClick={() => setOpen(!open)}
          className="text-xs text-zinc-500 hover:text-zinc-300 mt-3 transition-colors"
        >
          {open ? "Hide details" : "Show details"}
        </button>

        {open && (
          <div className="mt-3 pt-3 border-t border-zinc-800 space-y-3">
            {experiment.notes && (
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-1">Notes</p>
                <p className="text-sm text-zinc-300">{experiment.notes}</p>
              </div>
            )}

            {experiment.nextSteps.length > 0 && (
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-1">
                  Next Steps
                </p>
                <ul className="text-sm text-zinc-300 list-disc pl-4 space-y-0.5">
                  {experiment.nextSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {experiment.codeChanges.length > 0 && (
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-1">
                  Code Changes
                </p>
                {experiment.codeChanges.map((c) => (
                  <div key={c.id} className="mb-2">
                    <p className="text-xs text-zinc-400 font-mono">{c.file}</p>
                    <p className="text-xs text-zinc-500">{c.description}</p>
                    {c.diff && (
                      <pre className="mt-1 text-xs bg-zinc-800 border border-zinc-700 rounded p-2 overflow-x-auto text-zinc-300">
                        {c.diff}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}

            {experiment.configChanges.length > 0 && (
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-1">
                  Config Changes
                </p>
                {experiment.configChanges.map((c, i) => (
                  <div
                    key={i}
                    className="text-xs font-mono flex items-center gap-2"
                  >
                    <span className="text-zinc-400">{c.path}:</span>
                    <span className="text-red-400">
                      {JSON.stringify(c.oldValue)}
                    </span>
                    <span className="text-zinc-600">&rarr;</span>
                    <span className="text-emerald-400">
                      {JSON.stringify(c.newValue)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {experiment.significance.length > 0 && (
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-1">
                  Significance
                </p>
                <div className="text-xs space-y-0.5">
                  {experiment.significance.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 font-mono">
                      <span className="text-zinc-400 w-24">
                        {s.metricName}
                      </span>
                      <span
                        className={
                          s.significant ? "text-emerald-400" : "text-zinc-500"
                        }
                      >
                        p={s.pValue.toFixed(3)} d={s.effectSize.toFixed(2)}
                      </span>
                      {s.significant && (
                        <span className="text-emerald-400">*</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {logContent && (
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-1">
                  Experiment Log
                </p>
                <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-xs">
                  <MarkdownContent content={logContent} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import type { CodeChange } from "@/lib/forge-types";

export function DiffViewer({
  change,
  onSeeInConsole,
}: {
  change: CodeChange;
  onSeeInConsole?: () => void;
}) {
  const lines = change.diff ? change.diff.split("\n") : [];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-sm font-mono text-zinc-200">{change.file}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{change.description}</p>
          {change.hypothesis && (
            <p className="text-xs text-zinc-600 mt-0.5 italic">
              {change.hypothesis}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-zinc-600">
            {new Date(change.timestamp).toLocaleTimeString()}
          </span>
          {onSeeInConsole && (
            <button
              onClick={onSeeInConsole}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              See in console
            </button>
          )}
        </div>
      </div>

      {lines.length > 0 && (
        <div className="overflow-x-auto rounded bg-zinc-950 border border-zinc-800">
          <pre className="text-xs leading-relaxed p-3">
            {lines.map((line, i) => {
              let cls = "text-zinc-500"; // context
              if (line.startsWith("+") && !line.startsWith("+++")) {
                cls = "text-emerald-400 bg-emerald-950/30";
              } else if (line.startsWith("-") && !line.startsWith("---")) {
                cls = "text-red-400 bg-red-950/30";
              } else if (line.startsWith("@@")) {
                cls = "text-blue-400";
              } else if (line.startsWith("diff") || line.startsWith("index") || line.startsWith("---") || line.startsWith("+++")) {
                cls = "text-zinc-600";
              }

              return (
                <div key={i} className={`px-2 ${cls}`}>
                  {line}
                </div>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

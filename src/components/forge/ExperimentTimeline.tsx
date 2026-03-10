import type { ExperimentRecord } from "@/lib/forge-types";
import { ExperimentCard } from "./ExperimentCard";

export function ExperimentTimeline({
  experiments,
  logs,
}: {
  experiments: ExperimentRecord[];
  logs?: { filename: string; content: string }[];
}) {
  if (experiments.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        No experiments recorded yet.
      </div>
    );
  }

  // Build a map from experiment number to its markdown log content
  const logByNumber = new Map<number, string>();
  if (logs) {
    for (const log of logs) {
      const match = log.filename.match(/^(\d+)-/);
      if (match) {
        logByNumber.set(parseInt(match[1], 10), log.content);
      }
    }
  }

  return (
    <div className="relative">
      {experiments.map((exp) => (
        <ExperimentCard
          key={exp.id}
          experiment={exp}
          logContent={logByNumber.get(exp.number)}
        />
      ))}
    </div>
  );
}

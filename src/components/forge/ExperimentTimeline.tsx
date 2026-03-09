import type { ExperimentRecord } from "@/lib/forge-types";
import { ExperimentCard } from "./ExperimentCard";

export function ExperimentTimeline({
  experiments,
}: {
  experiments: ExperimentRecord[];
}) {
  if (experiments.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        No experiments recorded yet.
      </div>
    );
  }

  return (
    <div className="relative">
      {experiments.map((exp) => (
        <ExperimentCard key={exp.id} experiment={exp} />
      ))}
    </div>
  );
}

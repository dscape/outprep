import { getSessionSummaries, isForgeAvailable } from "@/lib/forge";
import { SessionCard } from "@/components/forge/SessionCard";
import { NewSessionButton } from "@/components/forge/NewSessionButton";
import { OrphanedBranchToast } from "@/components/forge/OrphanedBranchToast";

export const revalidate = 0;

export default function ForgeSessionsPage() {
  const forgeAvailable = isForgeAvailable();
  const sessions = getSessionSummaries();

  const totalExperiments = sessions.reduce((n, s) => n + s.experimentCount, 0);
  const totalCost = sessions.reduce((n, s) => n + s.totalCostUsd, 0);
  const bestScore = sessions.reduce<number | null>((best, s) => {
    if (s.bestCompositeScore === null) return best;
    if (best === null) return s.bestCompositeScore;
    return Math.max(best, s.bestCompositeScore);
  }, null);

  return (
    <div>
      <OrphanedBranchToast />
      {/* Header with New Session button */}
      <div className="flex items-center justify-end mb-4">
        <NewSessionButton />
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <Stat label="Sessions" value={String(sessions.length)} />
        <Stat label="Experiments" value={String(totalExperiments)} />
        <Stat label="Total Cost" value={`$${totalCost.toFixed(2)}`} mono />
        <Stat
          label="Best Composite"
          value={bestScore !== null ? bestScore.toFixed(3) : "—"}
          mono
        />
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          {!forgeAvailable ? (
            <p>
              Forge state file not found. Ensure{" "}
              <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300">
                packages/forge/forge-state.json
              </code>{" "}
              exists, or set <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300">FORGE_DATA_DIR</code>.
            </p>
          ) : (
            <p>
              No forge sessions found. Run{" "}
              <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300">
                npm run forge -- research
              </code>{" "}
              to start.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={`text-lg text-zinc-100 ${mono ? "font-mono" : "font-semibold"}`}>
        {value}
      </p>
    </div>
  );
}

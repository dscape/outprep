import Link from "next/link";
import type { SessionSummary } from "@/lib/forge-types";
import { StatusBadge } from "./StatusBadge";
import { CostDisplay } from "./CostDisplay";

export function SessionCard({ session }: { session: SessionSummary }) {
  const updated = new Date(session.updatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link
      href={`/forge/${session.id}`}
      className="block rounded-lg border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all group"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white">
            {session.name}
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {session.agentName && (
              <span className="text-zinc-400 font-medium">{session.agentName} &middot; </span>
            )}
            {session.players.join(", ")} &middot; {session.focus}
          </p>
        </div>
        <StatusBadge status={session.status} />
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-zinc-500 text-xs">Experiments</p>
          <p className="font-mono text-zinc-300">{session.experimentCount}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs">Oracle</p>
          <p className="font-mono text-zinc-300">{session.oracleCount}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs">Cost</p>
          <CostDisplay
            costUsd={session.totalCostUsd}
            inputTokens={session.totalInputTokens}
            outputTokens={session.totalOutputTokens}
            compact
          />
        </div>
      </div>

      {session.bestCompositeScore !== null && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <p className="text-xs text-zinc-500">
            Best composite:{" "}
            <span className="font-mono text-emerald-400">
              {session.bestCompositeScore.toFixed(3)}
            </span>
          </p>
        </div>
      )}

      <p className="text-xs text-zinc-600 mt-3">Updated {updated}</p>
    </Link>
  );
}

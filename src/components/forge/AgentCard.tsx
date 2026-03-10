import Link from "next/link";
import type { AgentSummary } from "@/lib/forge-types";
import { AgentStatusBadge } from "./AgentStatusBadge";

export function AgentCard({ agent }: { agent: AgentSummary }) {
  const sign = agent.avgWeightedCompositeDelta > 0 ? "+" : "";
  const hours = Math.round(agent.totalTimeSeconds / 3600);

  return (
    <Link
      href={`/forge/agents/${agent.id}`}
      className="block rounded-lg border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {agent.rank !== null && (
            <span className="flex items-center justify-center h-8 w-8 rounded-full bg-zinc-800 text-sm font-bold text-zinc-300 border border-zinc-700">
              #{agent.rank}
            </span>
          )}
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white">
              {agent.name}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {agent.config.players?.length
                ? <>{agent.config.players.join(", ")} &middot; {agent.config.focus ?? "accuracy"}</>
                : <span className="text-purple-400">Autonomous</span>}
            </p>
          </div>
        </div>
        <AgentStatusBadge isRunning={agent.isRunning} />
      </div>

      <div className="grid grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-zinc-500 text-xs">Avg &Delta;</p>
          <p className={`font-mono ${
            agent.avgWeightedCompositeDelta > 0 ? "text-emerald-400" : agent.avgWeightedCompositeDelta < 0 ? "text-red-400" : "text-zinc-400"
          }`}>
            {sign}{agent.avgWeightedCompositeDelta.toFixed(4)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs">Sessions</p>
          <p className="font-mono text-zinc-300">{agent.sessionCount}</p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs">Time</p>
          <p className="font-mono text-zinc-300">{hours}h</p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs">Cost</p>
          <p className="font-mono text-zinc-300">${agent.totalCostUsd.toFixed(2)}</p>
        </div>
      </div>

      {agent.currentSessionId && agent.currentSessionName && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <p className="text-xs text-zinc-500">
            Current session:{" "}
            <span className="text-zinc-300">{agent.currentSessionName}</span>
          </p>
        </div>
      )}
    </Link>
  );
}

import { getAgentSummaries, getLeaderboard } from "@/lib/forge";
import { AgentCard } from "@/components/forge/AgentCard";
import { Leaderboard } from "@/components/forge/Leaderboard";
import { AgentControls } from "./agent-controls";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  const agents = getAgentSummaries();
  const leaderboard = getLeaderboard();

  const running = agents.filter((a) => a.isRunning).length;
  const stopped = agents.filter((a) => !a.isRunning).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Agents</h2>
          <p className="text-sm text-zinc-500">
            {agents.length} agent{agents.length !== 1 ? "s" : ""} &middot;{" "}
            {running} running &middot; {stopped} stopped
          </p>
        </div>
        <AgentControls hasAgents={agents.length > 0} hasStoppedAgents={stopped > 0} hasRunningAgents={running > 0} />
      </div>

      {leaderboard.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Leaderboard</h3>
          <Leaderboard entries={leaderboard} />
        </div>
      )}

      {agents.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            No agents yet. Click <span className="text-emerald-400">+ New Agent</span> above to start one.
          </p>
          <p className="text-xs text-zinc-600 mt-1">
            Agents can run autonomously or focus on specific players and areas.
          </p>
        </div>
      )}
    </div>
  );
}

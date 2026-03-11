import { getAgentSummaries } from "@/lib/forge";
import { AgentCard } from "@/components/forge/AgentCard";
import { AgentControls } from "./agent-controls";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  const agents = getAgentSummaries();

  const running = agents.filter((a) => a.runStatus === "running").length;
  const waiting = agents.filter((a) => a.runStatus === "waiting_for_tool").length;
  const blocked = agents.filter((a) => a.runStatus === "blocked_on_permission").length;
  const dead = agents.filter((a) => a.runStatus === "dead").length;
  const stopped = agents.filter((a) => a.runStatus === "stopped").length;

  const statusParts: string[] = [];
  if (running > 0) statusParts.push(`${running} running`);
  if (waiting > 0) statusParts.push(`${waiting} waiting`);
  if (blocked > 0) statusParts.push(`${blocked} blocked`);
  if (dead > 0) statusParts.push(`${dead} dead`);
  if (stopped > 0) statusParts.push(`${stopped} stopped`);

  const hasRunningAgents = running > 0 || waiting > 0 || blocked > 0;
  const hasStoppedAgents = stopped > 0 || dead > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Agents</h2>
          <p className="text-sm text-zinc-500">
            {agents.length} agent{agents.length !== 1 ? "s" : ""}
            {statusParts.length > 0 && ` \u00b7 ${statusParts.join(" \u00b7 ")}`}
          </p>
        </div>
        <AgentControls hasAgents={agents.length > 0} hasStoppedAgents={hasStoppedAgents} hasRunningAgents={hasRunningAgents} />
      </div>

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

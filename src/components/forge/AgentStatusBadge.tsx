import type { AgentDisplayStatus } from "@/lib/forge-types";

interface AgentStatusBadgeProps {
  status: AgentDisplayStatus;
  detail?: string;
}

export function AgentStatusBadge({ status, detail }: AgentStatusBadgeProps) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-900/50 px-2.5 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-800/50">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Running
        </span>
      );
    case "waiting_for_tool":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-900/50 px-2.5 py-0.5 text-xs font-medium text-amber-400 border border-amber-800/50">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-spin rounded-full border border-amber-400 border-t-transparent opacity-75" />
          </span>
          Waiting{detail ? `: ${detail}` : ""}
        </span>
      );
    case "blocked_on_permission":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-900/50 px-2.5 py-0.5 text-xs font-medium text-red-400 border border-red-800/50">
          <span className="inline-flex h-2 w-2 rounded-full bg-red-500" />
          Blocked{detail ? `: ${detail}` : ""}
        </span>
      );
    case "dead":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-900/50 px-2.5 py-0.5 text-xs font-medium text-red-400 border border-red-800/50">
          <span className="inline-flex h-2 w-2 rounded-full bg-red-500" />
          Dead
        </span>
      );
    case "stopped":
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-400 border border-zinc-700/50">
          <span className="inline-flex h-2 w-2 rounded-full bg-zinc-500" />
          Stopped
        </span>
      );
  }
}

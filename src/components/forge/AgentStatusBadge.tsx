export function AgentStatusBadge({ isRunning }: { isRunning: boolean }) {
  if (isRunning) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-800/50">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Running
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400 border border-zinc-700/50">
      Stopped
    </span>
  );
}

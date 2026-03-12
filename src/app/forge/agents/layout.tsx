import type { ReactNode } from "react";
import { getLeaderboard } from "@/lib/forge";
import { Leaderboard } from "@/components/forge/Leaderboard";

export default function AgentsLayout({ children }: { children: ReactNode }) {
  const leaderboard = getLeaderboard();

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-5">
        <h3 className="text-sm font-semibold text-zinc-100 mb-3">Agent Leaderboard</h3>
        <Leaderboard entries={leaderboard} />
      </div>

      {children}
    </div>
  );
}

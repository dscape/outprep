import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/forge-types";

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  highlightAgentId?: string;
}

export function Leaderboard({ entries, highlightAgentId }: LeaderboardProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">
        No leaderboard entries yet. Start an agent to populate the leaderboard.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
            <th className="px-4 py-3 text-left font-medium">Rank</th>
            <th className="px-4 py-3 text-left font-medium">Agent</th>
            <th className="px-4 py-3 text-right font-medium">Weighted Avg &Delta;</th>
            <th className="px-4 py-3 text-right font-medium">Accuracy &Delta;</th>
            <th className="px-4 py-3 text-right font-medium">Sessions</th>
            <th className="px-4 py-3 text-right font-medium">Time</th>
            <th className="px-4 py-3 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const isHighlighted = e.agentId === highlightAgentId;
            const sign = e.avgWeightedCompositeDelta > 0 ? "+" : "";
            const accSign = e.avgAccuracyDelta > 0 ? "+" : "";
            const hours = Math.round(e.totalTimeSeconds / 3600);
            return (
              <tr
                key={e.agentId}
                className={`border-b border-zinc-800/50 ${
                  isHighlighted ? "bg-zinc-800/50" : "hover:bg-zinc-800/30"
                }`}
              >
                <td className="px-4 py-3 font-mono text-zinc-400">
                  #{e.rank}
                </td>
                <td className="px-4 py-3 font-medium text-zinc-200">
                  <Link
                    href={`/agents/${e.agentId}`}
                    className="hover:text-emerald-400 transition-colors"
                  >
                    {e.agentName}
                  </Link>
                  {isHighlighted && (
                    <span className="ml-2 text-xs text-emerald-400">YOU</span>
                  )}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${
                  e.avgWeightedCompositeDelta > 0 ? "text-emerald-400" : e.avgWeightedCompositeDelta < 0 ? "text-red-400" : "text-zinc-400"
                }`}>
                  {sign}{e.avgWeightedCompositeDelta.toFixed(4)}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${
                  e.avgAccuracyDelta > 0 ? "text-emerald-400" : e.avgAccuracyDelta < 0 ? "text-red-400" : "text-zinc-400"
                }`}>
                  {accSign}{(e.avgAccuracyDelta * 100).toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-400">
                  {e.sessionsCount}
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-400">
                  {hours}h
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-400">
                  ${e.totalCostUsd.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

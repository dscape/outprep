"use client";

import { useScout } from "./scout-context";

export default function UpgradeProgressBar() {
  const { isUpgrading, upgradeProgress } = useScout();

  if (!isUpgrading || !upgradeProgress) return null;

  return (
    <div className="mt-3 rounded-lg border border-zinc-700/30 bg-zinc-800/30 px-4 py-2">
      <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
        <span>Deepening analysis with Stockfish...</span>
        <span>{upgradeProgress.pct}%</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-700/50">
        <div
          className="h-full bg-green-500/70 transition-[width] duration-500"
          style={{ width: `${upgradeProgress.pct}%` }}
        />
      </div>
    </div>
  );
}

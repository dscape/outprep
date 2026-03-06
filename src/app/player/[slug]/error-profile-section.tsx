"use client";

import ErrorProfileCard from "@/components/ErrorProfileCard";
import { useScout } from "./scout-context";

export default function ErrorProfileSection() {
  const {
    filteredData,
    isPGNMode,
    fullLoading,
    platform,
    displayedErrorProfile,
    isUpgrading,
    upgradeProgress,
    upgradeComplete,
    displayedTotalGames,
    handleUpgrade,
    handleCancelUpgrade,
  } = useScout();

  // Skeleton while loading
  if (!filteredData && fullLoading) {
    return (
      <div className="mt-4 rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-5 rounded-md bg-zinc-700/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!filteredData || (!displayedErrorProfile && !isUpgrading && filteredData.games <= 0)) {
    return null;
  }

  return (
    <div className="mt-4">
      <ErrorProfileCard
        errorProfile={displayedErrorProfile || {
          opening: { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 },
          middlegame: { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 },
          endgame: { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 },
          overall: { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 },
          gamesAnalyzed: 0,
        }}
        totalGames={displayedTotalGames}
        onUpgrade={handleUpgrade}
        onCancel={handleCancelUpgrade}
        upgradeProgress={upgradeProgress}
        isUpgrading={isUpgrading}
        upgradeComplete={upgradeComplete}
        platform={platform}
      />
    </div>
  );
}

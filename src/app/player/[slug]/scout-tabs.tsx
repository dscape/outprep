"use client";

import { useState, useCallback } from "react";
import OpeningsTab from "@/components/OpeningsTab";
import WeaknessesTab from "@/components/WeaknessesTab";
import PrepTipsTab from "@/components/PrepTipsTab";
import type { OpeningStats } from "@/lib/types";
import type { GameForDrilldown } from "@/lib/game-helpers";
import { fromFidePGN, normalizedToGameForDrilldown } from "@/lib/normalized-game";
import { useScout } from "./scout-context";

type Tab = "openings" | "weaknesses" | "prep";

interface ScoutTabsProps {
  /** SSR opening data for FIDE players (instant from DB) */
  ssrOpenings?: { white: OpeningStats[]; black: OpeningStats[] };
  playerSlug?: string;
  playerName?: string;
  playerFideId?: string;
}

export default function ScoutTabs({
  ssrOpenings,
  playerSlug,
  playerName,
  playerFideId,
}: ScoutTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("openings");

  // FIDE game fetching (replaces fide-openings.tsx)
  const [fideGames, setFideGames] = useState<GameForDrilldown[] | undefined>();
  const [fideLoading, setFideLoading] = useState(false);

  const {
    filteredData,
    filteredPrepTips,
    selectedSpeeds,
    displayName,
    isPGNMode,
    isFIDEMode,
    fullLoading,
    enhancedWeaknesses,
    enhancedPrepTips,
    drilldownGames,
    pgnDrilldownGames,
    fetchRawGames,
    loadingDrilldownGames,
    coverageByOpening,
    handleAnalyzeGame,
    partialData,
  } = useScout();

  // Fetch FIDE games for opening drilldown
  const fetchFideGames = useCallback(async () => {
    if (fideGames || fideLoading || !playerSlug) return;
    setFideLoading(true);
    try {
      const res = await fetch(`/api/fide-games/${encodeURIComponent(playerSlug)}`);
      if (!res.ok) throw new Error("Failed to load games");
      const data = await res.json();
      const rawPgns: string[] = data.games || [];
      const converted = rawPgns.map((pgn: string, i: number) =>
        normalizedToGameForDrilldown(fromFidePGN(pgn, playerName || "", i, playerFideId))
      );
      setFideGames(converted);
    } catch {
      setFideGames([]);
    } finally {
      setFideLoading(false);
    }
  }, [playerSlug, playerName, playerFideId, fideGames, fideLoading]);

  const handleFideAnalyze = useCallback((game: GameForDrilldown) => {
    if (game.id && !game.id.startsWith("fide-game-")) {
      window.location.href = `/game/${game.id}`;
    }
  }, []);

  // Determine which openings data to use: client filtered → partial stream → SSR
  const openings = filteredData?.openings ?? partialData?.openings ?? ssrOpenings;

  // Use SSR openings path (FIDE with no client data yet) or client data path
  const useFidePath = isFIDEMode && !filteredData && ssrOpenings;

  const tabs: [Tab, string][] = [
    ["openings", "Openings"],
    ["weaknesses", "Weaknesses"],
    ["prep", "Prep Tips"],
  ];

  return (
    <>
      {/* Tabs */}
      <div className="mt-8">
        <div className="flex gap-1 border-b border-zinc-800">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === key
                  ? "border-green-500 text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-6 tab-content">
          {openings || filteredData || partialData ? (
            <>
              {activeTab === "openings" && openings && (
                useFidePath ? (
                  <OpeningsTab
                    white={openings.white}
                    black={openings.black}
                    games={fideGames}
                    onRequestGames={fetchFideGames}
                    loadingGames={fideLoading}
                    onAnalyzeGame={handleFideAnalyze}
                  />
                ) : (
                  <OpeningsTab
                    white={openings.white}
                    black={openings.black}
                    games={isPGNMode ? pgnDrilldownGames : drilldownGames}
                    onAnalyzeGame={handleAnalyzeGame}
                    onRequestGames={isPGNMode ? undefined : fetchRawGames}
                    loadingGames={isPGNMode ? false : loadingDrilldownGames}
                    coverageByOpening={isPGNMode ? undefined : coverageByOpening}
                  />
                )
              )}
              {activeTab === "weaknesses" && (
                !filteredData || (!enhancedWeaknesses && filteredData.weaknesses.length === 0 && fullLoading) ? (
                  <TabSkeleton />
                ) : (
                  <WeaknessesTab
                    weaknesses={enhancedWeaknesses ?? filteredData.weaknesses}
                    username={displayName}
                    speeds={selectedSpeeds.join(",")}
                  />
                )
              )}
              {activeTab === "prep" && (
                !filteredData || (!enhancedPrepTips && filteredPrepTips.length === 0 && fullLoading) ? (
                  <TabSkeleton />
                ) : (
                  <PrepTipsTab tips={enhancedPrepTips ?? filteredPrepTips} />
                )
              )}
            </>
          ) : (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 rounded-lg bg-zinc-800/30 animate-pulse" />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TabSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-4">
          <div className="h-4 w-1/3 rounded bg-zinc-700/40 animate-pulse mb-3" />
          <div className="h-3 w-2/3 rounded bg-zinc-700/30 animate-pulse mb-2" />
          <div className="h-3 w-1/2 rounded bg-zinc-700/20 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

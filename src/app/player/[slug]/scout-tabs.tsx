"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import OpeningsTab from "@/components/OpeningsTab";
import WeaknessesTab from "@/components/WeaknessesTab";
import PrepTipsTab from "@/components/PrepTipsTab";
import OTBAnalysisTab from "@/components/OTBAnalysisTab";
import OTBUploader from "@/components/OTBUploader";
import type { OpeningStats } from "@/lib/types";
import type { GameForDrilldown } from "@/lib/game-helpers";
import { fromFidePGN, normalizedToGameForDrilldown } from "@/lib/normalized-game";
import { useScout } from "./scout-context";

type Tab = "openings" | "weaknesses" | "prep" | "otb";

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
  const router = useRouter();
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
    otbProfile,
    handleOtbReady,
    handleOtbClear,
    enhancedWeaknesses,
    enhancedPrepTips,
    drilldownGames,
    pgnDrilldownGames,
    fetchRawGames,
    loadingDrilldownGames,
    coverageByOpening,
    handleAnalyzeGame,
  } = useScout();

  const handleOtbClearWithNav = useCallback(() => {
    handleOtbClear();
    if (activeTab === "otb") setActiveTab("openings");
    if (isPGNMode) router.push("/");
  }, [handleOtbClear, activeTab, isPGNMode, router]);

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

  // Determine which openings data to use: client filtered or SSR
  const openings = filteredData?.openings ?? ssrOpenings;

  // Use SSR openings path (FIDE with no client data yet) or client data path
  const useFidePath = isFIDEMode && !filteredData && ssrOpenings;

  const tabs: [Tab, string][] = [
    ["openings", "Openings"],
    ["weaknesses", "Weaknesses"],
    ["prep", "Prep Tips"],
    ...(!isPGNMode && otbProfile ? [["otb", "OTB Games"] as [Tab, string]] : []),
  ];

  return (
    <>
      {/* OTB PGN Upload */}
      <OTBUploader
        username={displayName}
        onProfileReady={handleOtbReady}
        existingProfile={otbProfile}
        onClear={handleOtbClearWithNav}
      />

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
          {openings || filteredData ? (
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
              {activeTab === "weaknesses" && filteredData && (
                <WeaknessesTab
                  weaknesses={enhancedWeaknesses ?? filteredData.weaknesses}
                  username={displayName}
                  speeds={selectedSpeeds.join(",")}
                />
              )}
              {activeTab === "prep" && (
                <PrepTipsTab tips={enhancedPrepTips ?? filteredPrepTips} />
              )}
              {activeTab === "otb" && otbProfile && (
                <OTBAnalysisTab profile={otbProfile} />
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

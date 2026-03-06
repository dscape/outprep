"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import PlayerCard from "@/components/PlayerCard";
import OpeningsTab from "@/components/OpeningsTab";
import WeaknessesTab from "@/components/WeaknessesTab";
import PrepTipsTab from "@/components/PrepTipsTab";
import OTBUploader from "@/components/OTBUploader";
import OTBAnalysisTab from "@/components/OTBAnalysisTab";
import ErrorProfileCard from "@/components/ErrorProfileCard";
import Toast from "@/components/Toast";
import { useScoutProfile } from "@/hooks/useScoutProfile";
import { useStockfishUpgrade } from "@/hooks/useStockfishUpgrade";
import { useDrilldownGames } from "@/hooks/useDrilldownGames";
import { TIME_RANGES } from "@/lib/profile-merge";
import type { Platform } from "@/lib/platform-utils";

type Tab = "openings" | "weaknesses" | "prep" | "otb";

interface ScoutFeaturesProps {
  platform: Platform;
  username: string;
}

export default function ScoutFeatures({ platform, username }: ScoutFeaturesProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("openings");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const scoutProfile = useScoutProfile({ platform, username });
  const {
    profile,
    basicData,
    filteredData,
    filteredPrepTips,
    selectedSpeeds,
    timeRange,
    setTimeRange,
    toggleSpeed,
    fullLoading,
    timeRangeLoading,
    error,
    availableSpeeds,
    displayName,
    handleOtbReady,
    handleOtbClear,
    otbProfile,
    isPGNMode,
    isChesscomMode,
  } = scoutProfile;

  const stockfishUpgrade = useStockfishUpgrade({
    platform,
    username,
    filteredData,
    selectedSpeeds,
    timeRange,
    isPGNMode,
    isChesscomMode,
  });
  const {
    displayedErrorProfile,
    isUpgrading,
    upgradeProgress,
    upgradeComplete,
    displayedTotalGames,
    handleUpgrade,
    handleCancelUpgrade,
    enhancedWeaknesses,
    enhancedPrepTips,
    enhancedErrorProfile,
  } = stockfishUpgrade;

  const drilldown = useDrilldownGames({
    platform,
    username,
    isPGNMode,
    isChesscomMode,
    timeRange,
    filteredData,
    otbProfile,
    profile,
  });
  const {
    drilldownGames,
    pgnDrilldownGames,
    fetchRawGames,
    loadingDrilldownGames,
    coverageByOpening,
    handleAnalyzeGame,
  } = drilldown;

  const handlePracticeClick = useCallback(() => {
    if (isPGNMode) {
      router.push(`/play/pgn:${encodeURIComponent(username)}`);
      return;
    }

    if (enhancedErrorProfile) {
      try {
        sessionStorage.setItem(
          `enhanced-profile:${username}`,
          JSON.stringify(enhancedErrorProfile)
        );
      } catch {
        // Storage full — non-fatal
      }
    }

    if (isUpgrading && upgradeProgress) {
      setToastMessage(
        `Analysis ${upgradeProgress.pct}% complete — bot may not reflect full game history`
      );
    } else if (!upgradeComplete && !enhancedErrorProfile) {
      setToastMessage(
        "Analysis hasn\u2019t started yet — the bot will use limited data"
      );
    }

    const sinceMs = TIME_RANGES.find(t => t.key === timeRange)?.ms;
    const since = sinceMs ? Date.now() - sinceMs : undefined;
    const platformPrefix = isChesscomMode ? "chesscom:" : platform === "fide" ? "fide:" : "";
    let playUrl = `/play/${platformPrefix}${encodeURIComponent(username)}?speeds=${selectedSpeeds.join(",")}`;
    if (since) playUrl += `&since=${since}`;
    router.push(playUrl);
  }, [isPGNMode, isChesscomMode, platform, isUpgrading, upgradeProgress, upgradeComplete, enhancedErrorProfile, username, selectedSpeeds, timeRange, router]);

  const handleOtbClearWithNav = useCallback(() => {
    handleOtbClear();
    if (activeTab === "otb") setActiveTab("openings");
    if (isPGNMode) router.push("/");
  }, [handleOtbClear, activeTab, isPGNMode, router]);

  if (error) {
    return (
      <div className="mt-8 text-center">
        <h2 className="text-xl font-bold text-white mb-2">Error</h2>
        <p className="text-zinc-400 mb-4">{error}</p>
        <button
          onClick={() => router.push("/")}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 transition-colors"
        >
          Try another player
        </button>
      </div>
    );
  }

  const tabs: [Tab, string][] = [
    ["openings", "Openings"],
    ["weaknesses", "Weaknesses"],
    ["prep", "Prep Tips"],
    ...(!isPGNMode && otbProfile ? [["otb", "OTB Games"] as [Tab, string]] : []),
  ];

  // Show spinner only when no data at all for online players
  if (!basicData && !profile && fullLoading && !isPGNMode && platform !== "fide") {
    return (
      <div className="mt-8 flex justify-center">
        <div className="h-12 w-12 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="mt-8">
      {/* Top progress bar for auto-scan */}
      {isUpgrading && upgradeProgress && (
        <div className="fixed top-0 left-0 right-0 z-50 h-1.5 bg-zinc-900 overflow-hidden">
          <div
            className="h-full bg-green-500 transition-[width] duration-500"
            style={{ width: `${upgradeProgress.pct}%` }}
          />
        </div>
      )}

      {/* Practice button + Filters */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* Speed Filter */}
          {profile && availableSpeeds.length >= 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 uppercase tracking-wide mr-1">
                Speed
              </span>
              {availableSpeeds.map((speed) => {
                const data = profile.bySpeed?.[speed];
                const isActive = selectedSpeeds.includes(speed);
                return (
                  <button
                    key={speed}
                    onClick={() => toggleSpeed(speed)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-green-600 text-white"
                        : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {speed.charAt(0).toUpperCase() + speed.slice(1)}{" "}
                    <span
                      className={isActive ? "text-green-200" : "text-zinc-600"}
                    >
                      {data?.games}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Time Range Filter */}
          {profile && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 uppercase tracking-wide mr-1">
                Period
              </span>
              {TIME_RANGES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => {
                    if (key !== timeRange) {
                      setTimeRange(key);
                    }
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    timeRange === key
                      ? "bg-green-600 text-white"
                      : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {label}
                  {timeRangeLoading && timeRange === key && (
                    <span className="ml-1.5 inline-block h-3 w-3 rounded-full border-2 border-green-200 border-t-transparent animate-spin align-middle" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {filteredData && (
          <button
            onClick={handlePracticeClick}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500"
            style={{ animation: "pulse-glow 2s ease-in-out infinite" }}
          >
            Practice &#9654;
          </button>
        )}
      </div>

      {/* Player Card — show when profile loaded, skeleton when only basicData */}
      {profile && filteredData ? (
        <PlayerCard profile={profile} filteredGames={filteredData.games} />
      ) : basicData ? (
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
          <div>
            <h2 className="text-2xl font-bold text-white">{basicData.username}</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Analyzing {basicData.totalGames.toLocaleString()} games...
            </p>
          </div>
          {Object.entries(basicData.ratings).filter(([, v]) => v !== undefined).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {Object.entries(basicData.ratings)
                .filter(([, v]) => v !== undefined)
                .map(([label, value]) => (
                  <div key={label} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm">
                    <span className="text-zinc-500 capitalize">{label}</span>{" "}
                    <span className="font-mono text-white">{value}</span>
                  </div>
                ))}
            </div>
          )}
          <div className="mt-6 space-y-3">
            <div className="h-4 w-24 rounded bg-zinc-700/50 animate-pulse" />
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-24 h-3 rounded bg-zinc-700/30 animate-pulse" />
                <div className="flex-1 h-2 rounded-full bg-zinc-700/30 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Error Profile */}
      {!isPGNMode && filteredData && (displayedErrorProfile || isUpgrading || filteredData.games > 0) && (
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
      )}

      {/* Skeleton for error profile while loading */}
      {!isPGNMode && !filteredData && fullLoading && (
        <div className="mt-4 rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5">
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-5 rounded-md bg-zinc-700/30 animate-pulse" />
            ))}
          </div>
        </div>
      )}

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
          {filteredData ? (
            <>
              {activeTab === "openings" && (
                <OpeningsTab
                  white={filteredData.openings.white}
                  black={filteredData.openings.black}
                  games={isPGNMode ? pgnDrilldownGames : drilldownGames}
                  onAnalyzeGame={handleAnalyzeGame}
                  onRequestGames={isPGNMode ? undefined : fetchRawGames}
                  loadingGames={isPGNMode ? false : loadingDrilldownGames}
                  coverageByOpening={isPGNMode ? undefined : coverageByOpening}
                />
              )}
              {activeTab === "weaknesses" && (
                <WeaknessesTab
                  weaknesses={enhancedWeaknesses ?? filteredData.weaknesses}
                  username={displayName}
                  speeds={selectedSpeeds.join(",")}
                />
              )}
              {activeTab === "prep" && <PrepTipsTab tips={enhancedPrepTips ?? filteredPrepTips} />}
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

      {/* Practice button */}
      {filteredData && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            onClick={handlePracticeClick}
            className="rounded-lg bg-green-600 px-6 py-3 text-lg font-medium text-white transition-colors hover:bg-green-500"
          >
            Practice against {displayName}
          </button>
          <p className="text-xs text-zinc-500 mt-1">
            Bot trained on {filteredData.games} {selectedSpeeds.join(" + ")} game{filteredData.games !== 1 ? "s" : ""}
            {timeRange !== "all" ? ` from ${TIME_RANGES.find(t => t.key === timeRange)?.label?.toLowerCase()}` : ""}
          </p>
        </div>
      )}

      {/* Toast */}
      {toastMessage && (
        <Toast
          message={toastMessage}
          progress={isUpgrading ? upgradeProgress?.pct : undefined}
          duration={5000}
          onDismiss={() => setToastMessage(null)}
        />
      )}
    </div>
  );
}

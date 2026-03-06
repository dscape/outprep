"use client";

import { createContext, useContext, ReactNode } from "react";
import { useScoutProfile } from "@/hooks/useScoutProfile";
import { useStockfishUpgrade } from "@/hooks/useStockfishUpgrade";
import { useDrilldownGames } from "@/hooks/useDrilldownGames";
import type { Platform } from "@/lib/platform-utils";

type ScoutContextValue = ReturnType<typeof useScoutProfile> &
  ReturnType<typeof useStockfishUpgrade> &
  ReturnType<typeof useDrilldownGames>;

const ScoutContext = createContext<ScoutContextValue | null>(null);

export function ScoutProvider({
  platform,
  username,
  children,
}: {
  platform: Platform;
  username: string;
  children: ReactNode;
}) {
  const scout = useScoutProfile({ platform, username });
  const {
    filteredData,
    selectedSpeeds,
    timeRange,
    isPGNMode,
    isChesscomMode,
    otbProfile,
    profile,
  } = scout;

  // For FIDE/PGN: pass local games so Stockfish can analyze them client-side
  const localGames = isPGNMode ? (profile?.games ?? otbProfile?.games) : undefined;
  const localPlayerName = isPGNMode ? (profile?.username ?? username) : undefined;

  const stockfish = useStockfishUpgrade({
    platform,
    username,
    filteredData,
    selectedSpeeds,
    timeRange,
    isPGNMode,
    isChesscomMode,
    localGames,
    localPlayerName,
  });

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

  return (
    <ScoutContext.Provider value={{ ...scout, ...stockfish, ...drilldown }}>
      {children}
    </ScoutContext.Provider>
  );
}

export function useScout() {
  const ctx = useContext(ScoutContext);
  if (!ctx) throw new Error("useScout must be used within ScoutProvider");
  return ctx;
}

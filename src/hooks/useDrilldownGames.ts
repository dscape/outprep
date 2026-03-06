"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { LichessGame, PlayerProfile } from "@/lib/types";
import type { NormalizedGame } from "@/lib/normalized-game";
import { fromLichessGame, fromChesscomGame, fromOTBGame, normalizedToGameForDrilldown } from "@/lib/normalized-game";
import type { GameForDrilldown } from "@/lib/game-helpers";
import { fetchChesscomGames } from "@/lib/chesscom";
import type { FilteredData } from "@/lib/profile-merge";
import { TIME_RANGES } from "@/lib/profile-merge";
import type { Platform } from "@/lib/platform-utils";

interface UseDrilldownGamesOptions {
  platform: Platform;
  username: string;
  isPGNMode: boolean;
  isChesscomMode: boolean;
  timeRange: string;
  filteredData: FilteredData | null;
  otbProfile: PlayerProfile | null;
  profile: PlayerProfile | null;
}

export function useDrilldownGames({
  platform,
  username,
  isPGNMode,
  isChesscomMode,
  timeRange,
  filteredData,
  otbProfile,
  profile,
}: UseDrilldownGamesOptions) {
  const router = useRouter();
  const [rawDrilldownGames, setRawDrilldownGames] = useState<NormalizedGame[] | null>(null);
  const [loadingDrilldownGames, setLoadingDrilldownGames] = useState(false);

  // Reset drill-down cache when time range changes
  useEffect(() => {
    setRawDrilldownGames(null);
  }, [timeRange]);

  const fetchRawGames = useCallback(async () => {
    if (rawDrilldownGames || loadingDrilldownGames || isPGNMode) return;
    setLoadingDrilldownGames(true);
    try {
      const sinceMs = TIME_RANGES.find(t => t.key === timeRange)?.ms;
      const since = sinceMs ? Date.now() - sinceMs : undefined;

      if (isChesscomMode) {
        const games = await fetchChesscomGames(username, 2000, since ?? undefined);
        const normalized = games.map((g) => fromChesscomGame(g, username));
        setRawDrilldownGames(normalized);
      } else {
        const params = new URLSearchParams({
          max: "2000",
          rated: "true",
          pgnInJson: "true",
          opening: "true",
        });
        if (since) params.set("since", String(since));
        const res = await fetch(
          `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`,
          { headers: { Accept: "application/x-ndjson" } }
        );
        if (!res.ok) {
          console.error("Failed to fetch games:", res.status);
          return;
        }
        const text = await res.text();
        const lines = text.trim().split("\n").filter(Boolean);
        const lichessGames: LichessGame[] = lines.map((line) => JSON.parse(line));
        const normalized = lichessGames.map((g) => fromLichessGame(g, username));
        setRawDrilldownGames(normalized);
      }
    } catch (err) {
      console.error("Failed to fetch games:", err);
    } finally {
      setLoadingDrilldownGames(false);
    }
  }, [username, rawDrilldownGames, loadingDrilldownGames, isPGNMode, isChesscomMode, timeRange]);

  // PGN drill-down games
  const pgnDrilldownGames = useMemo(() => {
    if (!isPGNMode || !otbProfile?.games) return undefined;
    const playerName = otbProfile.username || username;
    return otbProfile.games.map((g, i) =>
      normalizedToGameForDrilldown(fromOTBGame(g, playerName, i))
    );
  }, [isPGNMode, otbProfile, username]);

  const drilldownGames = useMemo(() => {
    if (!rawDrilldownGames) return undefined;
    return rawDrilldownGames.map(normalizedToGameForDrilldown);
  }, [rawDrilldownGames]);

  // Coverage map for opening badges
  const coverageByOpening = useMemo(() => {
    if (!rawDrilldownGames) return undefined;
    const map = new Map<string, { analyzed: number; total: number }>();
    for (const g of rawDrilldownGames) {
      if (!g.opening.name || g.opening.name === "Unknown") continue;
      if ((g.variant ?? "standard") !== "standard") continue;
      const family = g.opening.family;
      const entry = map.get(family) || { analyzed: 0, total: 0 };
      entry.total++;
      if (g.evals && g.evals.length > 0) entry.analyzed++;
      map.set(family, entry);
    }
    return map;
  }, [rawDrilldownGames]);

  const handleAnalyzeGame = useCallback(
    (game: GameForDrilldown) => {
      const storedGame = {
        pgn: game.pgn,
        result: game.result,
        playerColor: game.playerColor,
        opponentUsername: game.opponent,
        opponentFideEstimate: profile?.fideEstimate?.rating,
        scoutedUsername: username,
        scoutedPlatform: platform,
      };
      sessionStorage.setItem(`game:${game.id}`, JSON.stringify(storedGame));
      router.push(`/analysis/${game.id}`);
    },
    [router, username, profile, platform]
  );

  // Eagerly fetch raw games once profile loads
  useEffect(() => {
    if (filteredData && !isPGNMode && !rawDrilldownGames && !loadingDrilldownGames) {
      fetchRawGames();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredData, isPGNMode]);

  return {
    drilldownGames,
    pgnDrilldownGames,
    fetchRawGames,
    loadingDrilldownGames,
    coverageByOpening,
    handleAnalyzeGame,
  };
}

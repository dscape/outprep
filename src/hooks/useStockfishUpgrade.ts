"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type {
  Weakness,
  PrepTip,
  GameEvalData,
} from "@/lib/types";
import type { ErrorProfile } from "@outprep/engine";
import { buildErrorProfileFromEvals } from "@outprep/engine";
import { StockfishEngine } from "@/lib/stockfish-worker";
import {
  EvalMode,
  batchEvaluateGames,
} from "@/lib/engine/batch-eval";
import { getStoredEvals, storeEvals } from "@/lib/engine/eval-cache";
import {
  detectWeaknessesFromErrorProfile,
  generatePrepTips,
} from "@/lib/profile-builder";
import type { FilteredData } from "@/lib/profile-merge";
import { mergeErrorProfiles, TIME_RANGES } from "@/lib/profile-merge";
import type { Platform } from "@/lib/platform-utils";
import { matchesPlayerName, crc32 } from "@outprep/engine";

interface UseStockfishUpgradeOptions {
  platform: Platform;
  username: string;
  filteredData: FilteredData | null;
  selectedSpeeds: string[];
  timeRange: string;
  isPGNMode: boolean;
  isChesscomMode: boolean;
  /** OTB/FIDE games with moves — used for local Stockfish analysis when bot-data API isn't available */
  localGames?: Array<{ white: string; black: string; moves: string; date?: string; result: string }>;
  localPlayerName?: string;
}

export function useStockfishUpgrade({
  platform,
  username,
  filteredData,
  selectedSpeeds,
  timeRange,
  isPGNMode,
  isChesscomMode,
  localGames,
  localPlayerName,
}: UseStockfishUpgradeOptions) {
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [upgradeProgress, setUpgradeProgress] = useState<{
    gamesComplete: number;
    totalGames: number;
    pct: number;
  } | null>(null);
  const [enhancedErrorProfile, setEnhancedErrorProfile] =
    useState<ErrorProfile | null>(() => {
      if (typeof window === "undefined") return null;
      try {
        const cached = sessionStorage.getItem(`enhanced-profile:${username}`);
        if (cached) return JSON.parse(cached);
      } catch { /* ignore parse errors */ }
      return null;
    });
  const [upgradeComplete, setUpgradeComplete] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return !!sessionStorage.getItem(`enhanced-profile:${username}`);
    } catch { return false; }
  });
  const [totalGameCount, setTotalGameCount] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const c = sessionStorage.getItem(`enhanced-profile-total:${username}`);
      return c ? parseInt(c) : null;
    } catch { return null; }
  });
  const [enhancedWeaknesses, setEnhancedWeaknesses] = useState<Weakness[] | null>(null);
  const [enhancedPrepTips, setEnhancedPrepTips] = useState<PrepTip[] | null>(null);

  const evalEngineRef = useRef<StockfishEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const computedEvalsRef = useRef<GameEvalData[]>([]);
  const filteredDataRef = useRef<FilteredData | null>(null);
  const autoScanTriggeredRef = useRef(false);

  // Keep ref in sync
  filteredDataRef.current = filteredData;

  // SessionStorage cache is now loaded synchronously in useState initializers above,
  // avoiding a race condition where auto-scan would trigger before the cached profile was set.

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      evalEngineRef.current?.quit();
    };
  }, []);

  // Clear enhanced profile when speed/time filter changes
  useEffect(() => {
    if (!autoScanTriggeredRef.current) {
      return;
    }
    abortRef.current?.abort();
    setIsUpgrading(false);
    setUpgradeProgress(null);
    setEnhancedErrorProfile(null);
    setUpgradeComplete(false);
    setTotalGameCount(null);
    setEnhancedWeaknesses(null);
    setEnhancedPrepTips(null);
    autoScanTriggeredRef.current = false;
  }, [selectedSpeeds, timeRange]);

  // Helper: update weaknesses + prep tips from error profile
  const updateWeaknessesAndTips = useCallback((merged: ErrorProfile) => {
    const currentFilteredData = filteredDataRef.current;
    if (currentFilteredData) {
      const updatedWeaknesses = detectWeaknessesFromErrorProfile(
        merged,
        currentFilteredData.weaknesses
      );
      setEnhancedWeaknesses(updatedWeaknesses);
      setEnhancedPrepTips(
        generatePrepTips(updatedWeaknesses, currentFilteredData.openings, currentFilteredData.style)
      );
    }
  }, []);

  const handleUpgrade = useCallback(
    async (mode: EvalMode) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setIsUpgrading(true);
      setUpgradeProgress(null);
      setUpgradeComplete(false);
      computedEvalsRef.current = [];

      try {
        let allGameMoves: Array<{
          id: string;
          moves: string;
          playerColor: "white" | "black";
          hasEvals: boolean;
        }>;

        if (isPGNMode && localGames && localGames.length > 0 && localPlayerName) {
          // FIDE/PGN: build gameMoves from local profile games
          allGameMoves = localGames
            .filter((g) => g.moves && g.moves.trim().length > 0)
            .map((g, i) => {
              const isWhite = matchesPlayerName(g.white, localPlayerName);
              const isBlack = matchesPlayerName(g.black, localPlayerName);
              const playerIsWhite = isWhite && !isBlack ? true
                : isBlack && !isWhite ? false
                : isWhite;
              // For FIDE: extract numeric ID from slug (e.g. "alireza-firouzja-12573981" → "12573981")
              // For PGN: use username directly with PGN: prefix
              const fideIdMatch = platform === "fide" ? username.match(/-(\d{4,})$/) : null;
              const platformId = fideIdMatch ? fideIdMatch[1] : username;
              const platformPrefix = platform === "fide" ? "FIDE" : "PGN";
              return {
                id: `${platformPrefix}:${platformId}:${crc32(g.moves)}`,
                moves: g.moves,
                playerColor: (playerIsWhite ? "white" : "black") as "white" | "black",
                hasEvals: false,
              };
            });
        } else {
          // Online: fetch from bot-data API
          const sinceMs = TIME_RANGES.find(t => t.key === timeRange)?.ms;
          const sinceVal = sinceMs ? Date.now() - sinceMs : undefined;
          let query =
            selectedSpeeds.length > 0
              ? `?speeds=${encodeURIComponent(selectedSpeeds.join(","))}`
              : "";
          if (sinceVal) query += `${query ? "&" : "?"}since=${sinceVal}`;
          if (isChesscomMode) query += `${query ? "&" : "?"}platform=chesscom`;
          const res = await fetch(
            `/api/bot-data/${encodeURIComponent(username)}${query}`
          );
          if (!res.ok || abort.signal.aborted) {
            setIsUpgrading(false);
            return;
          }

          const botData = await res.json();
          allGameMoves = botData.gameMoves || [];
        }

        setTotalGameCount(allGameMoves.length);

        const noLichessEvals = allGameMoves.filter((g) => !g.hasEvals);

        // Check IndexedDB cache first
        const cachedEvalMap = await getStoredEvals(
          platform,
          username,
          noLichessEvals.map((g) => g.id),
        );

        // Also check DB for evals not in IndexedDB
        const uncachedIds = noLichessEvals
          .filter((g) => !cachedEvalMap.has(g.id))
          .map((g) => g.id);
        if (uncachedIds.length > 0) {
          try {
            const res = await fetch(
              `/api/game-evals?platform=${encodeURIComponent(platform)}&username=${encodeURIComponent(username)}&gameIds=${encodeURIComponent(uncachedIds.join(","))}`
            );
            if (res.ok) {
              const { evals: dbEvals } = await res.json();
              for (const [id, data] of Object.entries(dbEvals)) {
                if (data) cachedEvalMap.set(id, data as GameEvalData);
              }
            }
          } catch {
            // DB check failed — non-fatal, will compute with Stockfish
          }
        }

        const cachedEvals: GameEvalData[] = [];
        const needsStockfish: typeof noLichessEvals = [];
        for (const g of noLichessEvals) {
          const cached = cachedEvalMap.get(g.id);
          if (cached) {
            cachedEvals.push(cached);
          } else {
            needsStockfish.push(g);
          }
        }

        const baseProfile = filteredDataRef.current?.errorProfile;
        if (cachedEvals.length > 0) {
          const cachedProfile = buildErrorProfileFromEvals(cachedEvals);
          const initialMerged = baseProfile && baseProfile.gamesAnalyzed > 0
            ? mergeErrorProfiles([baseProfile, cachedProfile])
            : cachedProfile;
          setEnhancedErrorProfile(initialMerged);
          computedEvalsRef.current = cachedEvals;
          updateWeaknessesAndTips(initialMerged);
        }

        if (needsStockfish.length === 0) {
          setUpgradeProgress({
            gamesComplete: allGameMoves.length,
            totalGames: allGameMoves.length,
            pct: 100,
          });
          setUpgradeComplete(true);
          setIsUpgrading(false);
          return;
        }

        setUpgradeProgress({
          gamesComplete: 0,
          totalGames: needsStockfish.length,
          pct: 0,
        });

        if (!evalEngineRef.current) {
          try {
            const engine = new StockfishEngine();
            await engine.init();
            evalEngineRef.current = engine;
          } catch (err) {
            console.error("Engine init failed:", err);
            setUpgradeProgress(null);
            setIsUpgrading(false);
            return;
          }
        }

        if (abort.signal.aborted) return;

        const evalData = await batchEvaluateGames(
          evalEngineRef.current,
          needsStockfish,
          mode,
          (progress) => {
            if (abort.signal.aborted) return;
            setUpgradeProgress({
              gamesComplete: progress.gamesComplete,
              totalGames: progress.totalGames,
              pct:
                progress.totalEvals > 0
                  ? Math.round(
                      (progress.evalsComplete / progress.totalEvals) * 100
                    )
                  : 0,
            });
          },
          abort.signal,
          (batchResults, allResults) => {
            if (abort.signal.aborted) return;
            const allEvals = [...cachedEvals, ...allResults];
            const incrementalProfile = buildErrorProfileFromEvals(allEvals);
            const merged = baseProfile && baseProfile.gamesAnalyzed > 0
              ? mergeErrorProfiles([baseProfile, incrementalProfile])
              : incrementalProfile;
            setEnhancedErrorProfile(merged);
            computedEvalsRef.current = allEvals;
            updateWeaknessesAndTips(merged);

            const startIdx = allResults.length - batchResults.length;
            const batchEntries = batchResults.map((data, i) => ({
              gameId: needsStockfish[startIdx + i].id,
              data,
              evalMode: mode,
            }));
            // Store in IndexedDB (local cache)
            storeEvals(platform, username, batchEntries).catch(() => {});
            // Persist to DB in batches of 20
            const dbEntries = batchEntries.map((e) => ({
              gameId: e.gameId,
              evalData: e.data,
              evalMode: e.evalMode,
            }));
            fetch("/api/game-evals", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ platform, username, evals: dbEntries }),
            }).catch(() => {});
          },
        );

        if (abort.signal.aborted) return;

        const allEvals = [...cachedEvals, ...evalData];
        const computedProfile = buildErrorProfileFromEvals(allEvals);
        computedEvalsRef.current = allEvals;

        const merged =
          baseProfile && baseProfile.gamesAnalyzed > 0
            ? mergeErrorProfiles([baseProfile, computedProfile])
            : computedProfile;

        setEnhancedErrorProfile(merged);
        setUpgradeComplete(true);
        updateWeaknessesAndTips(merged);

        try {
          sessionStorage.setItem(
            `enhanced-profile:${username}`,
            JSON.stringify(merged)
          );
          sessionStorage.setItem(
            `enhanced-profile-total:${username}`,
            String(allGameMoves.length)
          );
        } catch {
          // Storage full — non-fatal
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("Upgrade error:", err);
        }
      } finally {
        if (!abort.signal.aborted) {
          setIsUpgrading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [username, platform, selectedSpeeds, timeRange, isPGNMode, localGames, localPlayerName, isChesscomMode, updateWeaknessesAndTips]
  );

  const handleCancelUpgrade = useCallback(() => {
    abortRef.current?.abort();
    setIsUpgrading(false);
    setUpgradeProgress(null);
  }, []);

  // Auto-start quick scan when profile loads
  useEffect(() => {
    if (
      filteredData &&
      !enhancedErrorProfile &&
      !isUpgrading &&
      !upgradeComplete &&
      !autoScanTriggeredRef.current &&
      filteredData.games > 0
    ) {
      // For FIDE/PGN, wait until localGames are available
      if (isPGNMode && (!localGames || localGames.length === 0)) return;
      autoScanTriggeredRef.current = true;
      handleUpgrade("sampling");
    }
  }, [filteredData, enhancedErrorProfile, isUpgrading, upgradeComplete, isPGNMode, localGames, handleUpgrade]);

  const displayedErrorProfile =
    enhancedErrorProfile || filteredData?.errorProfile;

  const displayedTotalGames =
    totalGameCount ?? filteredData?.games ?? undefined;

  return {
    enhancedErrorProfile,
    displayedErrorProfile,
    isUpgrading,
    upgradeProgress,
    upgradeComplete,
    displayedTotalGames,
    handleUpgrade,
    handleCancelUpgrade,
    enhancedWeaknesses,
    enhancedPrepTips,
  };
}

"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import type {
  PlayerProfile,
  OTBProfile,
  PrepTip,
  OpeningStats,
  PlayerRatings,
  FIDEEstimate,
} from "@/lib/types";
import type { Platform } from "@/lib/platform-utils";
import {
  FilteredData,
  SPEED_ORDER,
  TIME_RANGES,
  mergeSpeedProfiles,
} from "@/lib/profile-merge";
import { analyzeOTBGames } from "@/lib/otb-analyzer";
import { generatePrepTips } from "@/lib/profile-builder";

interface UseScoutProfileOptions {
  platform: Platform;
  username: string;
}

export function useScoutProfile({ platform, username }: UseScoutProfileOptions) {
  const isChesscomMode = platform === "chesscom";
  const isFIDEMode = platform === "fide";
  const isPGNMode = platform === "pgn" || isFIDEMode;

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [basicData, setBasicData] = useState<{
    username: string;
    ratings: Record<string, number | undefined>;
    totalGames: number;
  } | null>(null);
  const [partialData, setPartialData] = useState<{
    openings: { white: OpeningStats[]; black: OpeningStats[] };
    ratings: PlayerRatings;
    username: string;
    gameCount: number;
    fideEstimate?: FIDEEstimate;
  } | null>(null);
  const [fullLoading, setFullLoading] = useState(true);
  const [timeRangeLoading, setTimeRangeLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedSpeeds, setSelectedSpeeds] = useState<string[]>([]);
  // FIDE defaults to "3 months" — initialized synchronously to avoid race
  // with the main loading effect (which depends on timeRange).
  const [timeRange, setTimeRange] = useState<string>(isFIDEMode ? "3m" : "all");
  const [otbProfile, setOtbProfile] = useState<OTBProfile | null>(null);

  const profileRef = useRef<PlayerProfile | null>(null);

  // Bridge PGN profile into shared state
  const bridgePgnProfile = useCallback((otb: PlayerProfile) => {
    setOtbProfile(otb);
    setProfile(otb);
    profileRef.current = otb;
    const speeds = Object.keys(otb.bySpeed || {}).sort(
      (a, b) => SPEED_ORDER.indexOf(a) - SPEED_ORDER.indexOf(b)
    );
    setSelectedSpeeds(speeds.length > 0 ? speeds : ["classical"]);
  }, []);

  // Load OTB data from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(`otb:${username}`);
      if (stored) {
        setOtbProfile(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
  }, [username]);

  // Main data loading effect
  useEffect(() => {
    if (isPGNMode) {
      // Load full profile from sessionStorage or API, then apply date filter if active
      let fullProfile: PlayerProfile | null = null;

      try {
        const stored =
          sessionStorage.getItem(`fide-import:${username}`) ||
          sessionStorage.getItem(`pgn-import:${username}`);
        if (stored) {
          fullProfile = JSON.parse(stored) as PlayerProfile;
        }
      } catch {
        // Parse error — fall through to API fetch
      }

      if (!fullProfile && isFIDEMode) {
        (async () => {
          try {
            // Pass since param to API so DB can filter by date
            const sinceMs = timeRange !== "all" ? TIME_RANGES.find(t => t.key === timeRange)?.ms : undefined;
            const sinceVal = sinceMs ? Date.now() - sinceMs : undefined;
            const query = sinceVal ? `?since=${sinceVal}` : "";
            const res = await fetch(
              `/api/fide-practice/${encodeURIComponent(username)}${query}`
            );
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              setError(body.error || "Failed to load games");
              setFullLoading(false);
              return;
            }
            const data = await res.json() as PlayerProfile;
            try {
              sessionStorage.setItem(
                `fide-import:${username}`,
                JSON.stringify(data)
              );
            } catch {
              // Quota exceeded — non-fatal
            }
            // Apply date filter or use full profile
            applyPgnProfile(data);
          } catch {
            setError("Failed to load games. Please try again.");
          } finally {
            setFullLoading(false);
          }
        })();
        return;
      }

      if (!fullProfile) {
        setError("PGN data not found. Please go back and re-upload.");
        setFullLoading(false);
        return;
      }

      applyPgnProfile(fullProfile);
      setFullLoading(false);
      return;
    }

    function applyPgnProfile(full: PlayerProfile) {
      // Always keep full data in otbProfile for switching back to "all time"
      if (!otbProfile) setOtbProfile(full);

      if (timeRange !== "all" && full.games && full.games.length > 0) {
        setTimeRangeLoading(true);
        const sinceMs = TIME_RANGES.find(t => t.key === timeRange)?.ms;
        if (sinceMs) {
          const cutoff = Date.now() - sinceMs;
          const filtered = full.games.filter(g => {
            if (!g.date) return true;
            const d = new Date(g.date.replace(/\./g, "-"));
            return !isNaN(d.getTime()) && d.getTime() >= cutoff;
          });
          if (filtered.length > 0) {
            const reanalyzed = analyzeOTBGames(filtered, full.username);
            if (full.ratings) reanalyzed.ratings = full.ratings;
            if (full.fideEstimate) reanalyzed.fideEstimate = full.fideEstimate;
            setProfile(reanalyzed);
            profileRef.current = reanalyzed;
            const speeds = Object.keys(reanalyzed.bySpeed || {}).sort(
              (a, b) => SPEED_ORDER.indexOf(a) - SPEED_ORDER.indexOf(b)
            );
            setSelectedSpeeds(speeds.length > 0 ? speeds : ["classical"]);
            setTimeRangeLoading(false);
            return;
          }
          // No games match this time range — show empty profile, not full profile
          const emptyProfile: PlayerProfile = {
            username: full.username,
            platform: full.platform,
            totalGames: full.totalGames,
            analyzedGames: 0,
            ratings: full.ratings || {},
            fideEstimate: full.fideEstimate,
            style: { aggression: 0, tactical: 0, positional: 0, endgame: 0, sampleSize: 0 },
            weaknesses: [],
            openings: { white: [], black: [] },
            prepTips: [],
            lastComputed: Date.now(),
            games: [],
          };
          setProfile(emptyProfile);
          profileRef.current = emptyProfile;
          setSelectedSpeeds(["classical"]);
          setTimeRangeLoading(false);
          return;
        }
        setTimeRangeLoading(false);
      }

      // "all time" or no filtered results — use full profile
      bridgePgnProfile(full);
    }

    // Phase 1: Fast basic data
    async function loadBasic() {
      try {
        const basicQuery = isChesscomMode ? "?platform=chesscom" : "";
        const res = await fetch(
          `/api/profile-basic/${encodeURIComponent(username)}${basicQuery}`
        );
        if (res.ok) {
          setBasicData(await res.json());
        }
      } catch {
        // Non-fatal
      }
    }

    // Phase 2: Full profile (supports NDJSON streaming or JSON cache hit)
    async function loadFullProfile(isTimeRangeChange: boolean) {
      if (isTimeRangeChange) {
        setTimeRangeLoading(true);
      }
      try {
        const sinceMs = TIME_RANGES.find(t => t.key === timeRange)?.ms;
        const since = sinceMs ? Date.now() - sinceMs : undefined;
        const queryParams = new URLSearchParams();
        if (since) queryParams.set("since", String(since));
        if (isChesscomMode) queryParams.set("platform", "chesscom");
        const queryStr = queryParams.toString() ? `?${queryParams}` : "";
        const res = await fetch(
          `/api/profile/${encodeURIComponent(username)}${queryStr}`
        );

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Failed to load profile");
          setFullLoading(false);
          setTimeRangeLoading(false);
          return;
        }

        const contentType = res.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          // Cache hit — single JSON response
          const data = await res.json();
          setProfile(data);
          profileRef.current = data;
          setSelectedSpeeds(
            Object.keys(data.bySpeed || {}).sort(
              (a, b) => SPEED_ORDER.indexOf(a) - SPEED_ORDER.indexOf(b)
            )
          );
        } else {
          // Streaming NDJSON — read progressively
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop()!;
            for (const line of lines) {
              if (!line.trim()) continue;
              const chunk = JSON.parse(line);
              if (chunk.type === "error") {
                setError(chunk.error || "Failed to load profile");
              } else if (chunk.type === "openings") {
                setPartialData(chunk);
                setBasicData({
                  username: chunk.username,
                  ratings: chunk.ratings,
                  totalGames: chunk.gameCount,
                });
              } else if (chunk.type === "profile") {
                setProfile(chunk.profile);
                profileRef.current = chunk.profile;
                setSelectedSpeeds(
                  Object.keys(chunk.profile.bySpeed || {}).sort(
                    (a, b) => SPEED_ORDER.indexOf(a) - SPEED_ORDER.indexOf(b)
                  )
                );
              }
            }
          }
        }
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setFullLoading(false);
        setTimeRangeLoading(false);
      }
    }

    loadBasic();
    const isTimeRangeChange = !!profileRef.current;
    loadFullProfile(isTimeRangeChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, isPGNMode, isFIDEMode, timeRange, bridgePgnProfile]);

  // Cache profile in sessionStorage for play page
  useEffect(() => {
    if (!profile && !isPGNMode) return;
    try {
      sessionStorage.setItem(
        `play-profile:${username}`,
        JSON.stringify(
          profile
            ? { username: profile.username, fideEstimate: profile.fideEstimate }
            : { username, fideEstimate: { rating: 0 } }
        )
      );
    } catch {
      // Storage full — non-fatal
    }
  }, [profile, username, isPGNMode]);


  const toggleSpeed = useCallback((speed: string) => {
    setSelectedSpeeds((prev) => {
      if (prev.includes(speed)) {
        if (prev.length === 1) return prev;
        return prev.filter((s) => s !== speed);
      }
      return [...prev, speed].sort(
        (a, b) => SPEED_ORDER.indexOf(a) - SPEED_ORDER.indexOf(b)
      );
    });
  }, []);

  const handleOtbReady = useCallback(
    (otb: OTBProfile) => {
      if (isPGNMode) {
        bridgePgnProfile(otb);
      } else {
        setOtbProfile(otb);
      }
      try {
        const key = isFIDEMode
          ? `fide-import:${username}`
          : isPGNMode
            ? `pgn-import:${username}`
            : `otb:${username}`;
        sessionStorage.setItem(key, JSON.stringify(otb));
      } catch {
        // Storage full — non-fatal
      }
    },
    [username, isPGNMode, isFIDEMode, bridgePgnProfile]
  );

  const handleOtbClear = useCallback(() => {
    setOtbProfile(null);
    try {
      if (isFIDEMode) {
        sessionStorage.removeItem(`fide-import:${username}`);
      } else if (isPGNMode) {
        sessionStorage.removeItem(`pgn-import:${username}`);
      } else {
        sessionStorage.removeItem(`otb:${username}`);
      }
    } catch {
      // Ignore
    }
  }, [username, isPGNMode, isFIDEMode]);

  const filteredData = useMemo((): FilteredData | null => {
    if (!profile) return null;
    const allSpeeds = Object.keys(profile.bySpeed || {});

    if (
      selectedSpeeds.length === 0 ||
      selectedSpeeds.length === allSpeeds.length
    ) {
      return {
        style: profile.style,
        openings: profile.openings,
        weaknesses: profile.weaknesses,
        errorProfile: profile.errorProfile,
        games: profile.analyzedGames,
      };
    }

    if (selectedSpeeds.length === 1) {
      const sp = profile.bySpeed?.[selectedSpeeds[0]];
      if (sp) return { ...sp };
    }

    return mergeSpeedProfiles(profile, selectedSpeeds);
  }, [profile, selectedSpeeds]);

  const filteredPrepTips = useMemo((): PrepTip[] => {
    if (!filteredData) return [];
    return generatePrepTips(filteredData.weaknesses, filteredData.openings, filteredData.style);
  }, [filteredData]);

  const displayName = profile?.username || basicData?.username || username;

  const availableSpeeds = Object.keys(profile?.bySpeed || {}).sort(
    (a, b) => SPEED_ORDER.indexOf(a) - SPEED_ORDER.indexOf(b)
  );

  return {
    profile,
    basicData,
    partialData,
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
    isFIDEMode,
    platform,
    profileRef,
  };
}

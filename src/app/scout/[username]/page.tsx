"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  PlayerProfile,
  OTBProfile,
  StyleMetrics,
  OpeningStats,
  Weakness,
  PrepTip,
  PhaseErrors,
  GameEvalData,
} from "@/lib/types";
import type { ErrorProfile } from "@outprep/engine";
import { buildErrorProfileFromEvals } from "@outprep/engine";
import { StockfishEngine } from "@/lib/stockfish-worker";
import {
  EvalMode,
  batchEvaluateGames,
} from "@/lib/engine/batch-eval";
import PlayerCard from "@/components/PlayerCard";
import OpeningsTab from "@/components/OpeningsTab";
import WeaknessesTab from "@/components/WeaknessesTab";
import PrepTipsTab from "@/components/PrepTipsTab";
import OTBUploader from "@/components/OTBUploader";
import OTBAnalysisTab from "@/components/OTBAnalysisTab";
import ErrorProfileCard from "@/components/ErrorProfileCard";
import {
  GameForDrilldown,
  otbGamesToDrilldown,
  lichessGamesToDrilldown,
} from "@/lib/game-helpers";
import {
  openingFamily,
  detectWeaknessesFromErrorProfile,
  generatePrepTips,
} from "@/lib/profile-builder";
import { LichessGame } from "@/lib/types";

type Tab = "openings" | "weaknesses" | "prep" | "otb";

interface FilteredData {
  style: StyleMetrics;
  openings: { white: OpeningStats[]; black: OpeningStats[] };
  weaknesses: Weakness[];
  errorProfile?: ErrorProfile;
  games: number;
}

function mergeOpenings(
  openingsSets: { white: OpeningStats[]; black: OpeningStats[] }[]
): { white: OpeningStats[]; black: OpeningStats[] } {
  const mergeColor = (lists: OpeningStats[][]): OpeningStats[] => {
    const map = new Map<
      string,
      {
        eco: string;
        name: string;
        wins: number;
        draws: number;
        losses: number;
        total: number;
      }
    >();
    for (const list of lists) {
      for (const op of list) {
        const existing = map.get(op.name);
        if (existing) {
          existing.total += op.games;
          existing.wins += Math.round((op.winRate / 100) * op.games);
          existing.draws += Math.round((op.drawRate / 100) * op.games);
          existing.losses += Math.round((op.lossRate / 100) * op.games);
        } else {
          map.set(op.name, {
            eco: op.eco,
            name: op.name,
            wins: Math.round((op.winRate / 100) * op.games),
            draws: Math.round((op.drawRate / 100) * op.games),
            losses: Math.round((op.lossRate / 100) * op.games),
            total: op.games,
          });
        }
      }
    }
    const totalGames = Array.from(map.values()).reduce(
      (sum, e) => sum + e.total,
      0
    );
    return Array.from(map.values())
      .filter((e) => e.total >= 2)
      .sort((a, b) => b.total - a.total)
      .slice(0, 15)
      .map((e) => ({
        eco: e.eco,
        name: e.name,
        games: e.total,
        pct: totalGames > 0 ? Math.round((e.total / totalGames) * 100) : 0,
        winRate: e.total > 0 ? Math.round((e.wins / e.total) * 100) : 0,
        drawRate: e.total > 0 ? Math.round((e.draws / e.total) * 100) : 0,
        lossRate: e.total > 0 ? Math.round((e.losses / e.total) * 100) : 0,
      }));
  };

  return {
    white: mergeColor(openingsSets.map((o) => o.white)),
    black: mergeColor(openingsSets.map((o) => o.black)),
  };
}

function mergeSpeedProfiles(
  profile: PlayerProfile,
  speeds: string[]
): FilteredData {
  let totalGames = 0;
  let aggSum = 0,
    tacSum = 0,
    posSum = 0,
    endSum = 0;

  for (const s of speeds) {
    const sp = profile.bySpeed[s];
    if (!sp) continue;
    totalGames += sp.games;
    aggSum += sp.style.aggression * sp.games;
    tacSum += sp.style.tactical * sp.games;
    posSum += sp.style.positional * sp.games;
    endSum += sp.style.endgame * sp.games;
  }

  const style: StyleMetrics =
    totalGames > 0
      ? {
          aggression: Math.round(aggSum / totalGames),
          tactical: Math.round(tacSum / totalGames),
          positional: Math.round(posSum / totalGames),
          endgame: Math.round(endSum / totalGames),
          sampleSize: totalGames,
        }
      : profile.style;

  const openingsSets = speeds
    .map((s) => profile.bySpeed[s]?.openings)
    .filter(
      (o): o is { white: OpeningStats[]; black: OpeningStats[] } => !!o
    );
  const openings = mergeOpenings(openingsSets);

  const seen = new Set<string>();
  const weaknesses: Weakness[] = [];
  for (const s of speeds) {
    for (const w of profile.bySpeed[s]?.weaknesses || []) {
      if (!seen.has(w.area)) {
        seen.add(w.area);
        weaknesses.push(w);
      }
    }
  }

  // Merge error profiles across speeds
  const errorProfiles = speeds
    .map((s) => profile.bySpeed[s]?.errorProfile)
    .filter((e): e is ErrorProfile => !!e && e.gamesAnalyzed > 0);
  const errorProfile =
    errorProfiles.length > 0 ? mergeErrorProfiles(errorProfiles) : undefined;

  return { style, openings, weaknesses, errorProfile, games: totalGames };
}

function mergePhaseErrors(phases: PhaseErrors[]): PhaseErrors {
  let totalMoves = 0,
    mistakes = 0,
    blunders = 0,
    totalCPL = 0;
  for (const p of phases) {
    totalMoves += p.totalMoves;
    mistakes += p.mistakes;
    blunders += p.blunders;
    totalCPL += p.avgCPL * p.totalMoves;
  }
  const totalErrors = mistakes + blunders;
  return {
    totalMoves,
    mistakes,
    blunders,
    avgCPL: totalMoves > 0 ? Math.round(totalCPL / totalMoves) : 0,
    errorRate: totalMoves > 0 ? totalErrors / totalMoves : 0,
    blunderRate: totalMoves > 0 ? blunders / totalMoves : 0,
  };
}

function mergeErrorProfiles(profiles: ErrorProfile[]): ErrorProfile {
  return {
    opening: mergePhaseErrors(profiles.map((p) => p.opening)),
    middlegame: mergePhaseErrors(profiles.map((p) => p.middlegame)),
    endgame: mergePhaseErrors(profiles.map((p) => p.endgame)),
    overall: mergePhaseErrors(profiles.map((p) => p.overall)),
    gamesAnalyzed: profiles.reduce((sum, p) => sum + p.gamesAnalyzed, 0),
  };
}

const SPEED_ORDER = ["bullet", "blitz", "rapid", "classical"];
const TIME_RANGES = [
  { key: "1m", label: "Last month", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "3m", label: "3 months", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "1y", label: "Last year", ms: 365 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All time", ms: 0 },
];

export default function ScoutPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawUsername = params.username as string;
  const username = decodeURIComponent(rawUsername);
  const isPGNMode = searchParams.get("source") === "pgn";

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [basicData, setBasicData] = useState<{
    username: string;
    ratings: Record<string, number | undefined>;
    totalGames: number;
  } | null>(null);
  const [fullLoading, setFullLoading] = useState(true);
  const [timeRangeLoading, setTimeRangeLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("openings");
  const [selectedSpeeds, setSelectedSpeeds] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<string>("all");
  const [otbProfile, setOtbProfile] = useState<OTBProfile | null>(null);

  // Upgrade state
  const [showPlayConfirm, setShowPlayConfirm] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [upgradeProgress, setUpgradeProgress] = useState<{
    gamesComplete: number;
    totalGames: number;
    pct: number;
  } | null>(null);
  const [enhancedErrorProfile, setEnhancedErrorProfile] =
    useState<ErrorProfile | null>(null);
  const [upgradeComplete, setUpgradeComplete] = useState(false);
  const [totalGameCount, setTotalGameCount] = useState<number | null>(null);
  const [enhancedWeaknesses, setEnhancedWeaknesses] = useState<Weakness[] | null>(null);
  const [enhancedPrepTips, setEnhancedPrepTips] = useState<PrepTip[] | null>(null);
  const evalEngineRef = useRef<StockfishEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const computedEvalsRef = useRef<GameEvalData[]>([]);
  const profileRef = useRef<PlayerProfile | null>(null);

  // Drill-down: raw Lichess games for opening expansion
  const [rawLichessGames, setRawLichessGames] = useState<LichessGame[] | null>(null);
  const [loadingLichessGames, setLoadingLichessGames] = useState(false);

  // Load OTB data and cached enhanced profile from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(`otb:${username}`);
      if (stored) {
        setOtbProfile(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
    try {
      const cached = sessionStorage.getItem(`enhanced-profile:${username}`);
      const cachedCount = sessionStorage.getItem(
        `enhanced-profile-total:${username}`
      );
      if (cached) {
        setEnhancedErrorProfile(JSON.parse(cached));
        setUpgradeComplete(true);
        if (cachedCount) setTotalGameCount(parseInt(cachedCount));
      }
    } catch {
      // Ignore parse errors
    }
  }, [username]);

  useEffect(() => {
    if (isPGNMode) {
      try {
        const stored = sessionStorage.getItem(
          `pgn-import:${username}`
        );
        if (stored) {
          setOtbProfile(JSON.parse(stored));
        } else {
          setError("PGN data not found. Please go back and re-upload.");
        }
      } catch {
        setError("Failed to load PGN data.");
      }
      setFullLoading(false);
      return;
    }

    // Phase 1: Fast basic data (username + ratings)
    async function loadBasic() {
      try {
        const res = await fetch(
          `/api/profile-basic/${encodeURIComponent(username)}`
        );
        if (res.ok) {
          setBasicData(await res.json());
        }
      } catch {
        // Non-fatal: full profile will provide this data
      }
    }

    // Phase 2: Full profile with analysis
    async function loadFullProfile(isTimeRangeChange: boolean) {
      if (isTimeRangeChange) {
        setTimeRangeLoading(true);
      }
      try {
        const sinceMs = TIME_RANGES.find(t => t.key === timeRange)?.ms;
        const since = sinceMs ? Date.now() - sinceMs : undefined;
        const sinceQuery = since ? `?since=${since}` : "";
        const res = await fetch(
          `/api/profile/${encodeURIComponent(username)}${sinceQuery}`
        );

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Failed to load profile");
          setFullLoading(false);
          setTimeRangeLoading(false);
          return;
        }

        const data = await res.json();
        setProfile(data);
        profileRef.current = data;
        // Default: all available speeds selected
        setSelectedSpeeds(
          Object.keys(data.bySpeed || {}).sort(
            (a, b) => SPEED_ORDER.indexOf(a) - SPEED_ORDER.indexOf(b)
          )
        );
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setFullLoading(false);
        setTimeRangeLoading(false);
      }
    }

    loadBasic();
    // Only show full loading skeleton on initial load, not time range changes
    const isTimeRangeChange = !!profileRef.current;
    loadFullProfile(isTimeRangeChange);
  }, [username, isPGNMode, timeRange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      evalEngineRef.current?.quit();
    };
  }, []);

  // Cache profile in sessionStorage for instant play page loading
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

  // Pre-warm bot-data server cache for the play page
  useEffect(() => {
    if (!profile || selectedSpeeds.length === 0) return;
    const sinceMs = TIME_RANGES.find(t => t.key === timeRange)?.ms;
    const since = sinceMs ? Date.now() - sinceMs : undefined;
    let query = `?speeds=${encodeURIComponent(selectedSpeeds.join(","))}`;
    if (since) query += `&since=${since}`;
    fetch(`/api/bot-data/${encodeURIComponent(username)}${query}`).catch(
      () => {}
    );
  }, [profile, selectedSpeeds, username, timeRange]);

  const toggleSpeed = useCallback((speed: string) => {
    setSelectedSpeeds((prev) => {
      if (prev.includes(speed)) {
        if (prev.length === 1) return prev; // Don't deselect last one
        return prev.filter((s) => s !== speed);
      }
      return [...prev, speed].sort(
        (a, b) => SPEED_ORDER.indexOf(a) - SPEED_ORDER.indexOf(b)
      );
    });
  }, []);

  const handleOtbReady = useCallback(
    (otb: OTBProfile) => {
      setOtbProfile(otb);
      if (!isPGNMode) setActiveTab("otb");
      try {
        const key = isPGNMode
          ? `pgn-import:${username}`
          : `otb:${username}`;
        sessionStorage.setItem(key, JSON.stringify(otb));
      } catch {
        // Storage full — non-fatal
      }
    },
    [username, isPGNMode]
  );

  const handleOtbClear = useCallback(() => {
    setOtbProfile(null);
    if (activeTab === "otb") setActiveTab("openings");
    try {
      if (isPGNMode) {
        sessionStorage.removeItem(
          `pgn-import:${username}`
        );
      } else {
        sessionStorage.removeItem(`otb:${username}`);
      }
    } catch {
      // Ignore
    }
    if (isPGNMode) router.push("/");
  }, [username, activeTab, isPGNMode, router]);

  // Clear enhanced (upgrade) error profile when speed filter changes
  // so the base speed-filtered profile is used instead
  useEffect(() => {
    setEnhancedErrorProfile(null);
    setUpgradeComplete(false);
    setTotalGameCount(null);
    setEnhancedWeaknesses(null);
    setEnhancedPrepTips(null);
  }, [selectedSpeeds, timeRange]);

  const filteredData = useMemo((): FilteredData | null => {
    if (!profile) return null;
    const allSpeeds = Object.keys(profile.bySpeed);

    // All speeds selected or none → use aggregate
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

    // Single speed → use pre-computed
    if (selectedSpeeds.length === 1) {
      const sp = profile.bySpeed[selectedSpeeds[0]];
      if (sp) return { ...sp };
    }

    // Multi-speed merge
    return mergeSpeedProfiles(profile, selectedSpeeds);
  }, [profile, selectedSpeeds]);

  // Compute prep tips for the current filter selection
  const filteredPrepTips = useMemo((): PrepTip[] => {
    if (!filteredData) return [];
    return generatePrepTips(filteredData.weaknesses, filteredData.openings, filteredData.style);
  }, [filteredData]);

  // Drill-down: navigate to analysis page for a single game
  // Keep the scouted player's perspective (their color, their performance)
  const handleAnalyzeGame = useCallback(
    (game: GameForDrilldown) => {
      const storedGame = {
        pgn: game.pgn,
        result: game.result,
        playerColor: game.playerColor,
        opponentUsername: game.opponent,
        opponentFideEstimate: profile?.fideEstimate?.rating,
        scoutedUsername: username,
      };
      sessionStorage.setItem(`game:${game.id}`, JSON.stringify(storedGame));
      router.push(`/analysis/${game.id}`);
    },
    [router, username, profile]
  );

  // Drill-down: lazy-fetch raw Lichess games for opening expansion
  const fetchLichessRawGames = useCallback(async () => {
    if (rawLichessGames || loadingLichessGames || isPGNMode) return;
    setLoadingLichessGames(true);
    try {
      const params = new URLSearchParams({
        max: "500",
        rated: "true",
        pgnInJson: "true",
        opening: "true",
      });
      const res = await fetch(
        `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`,
        { headers: { Accept: "application/x-ndjson" } }
      );
      if (!res.ok) {
        console.error("Failed to fetch Lichess games:", res.status);
        return;
      }
      const text = await res.text();
      const lines = text.trim().split("\n").filter(Boolean);
      const games: LichessGame[] = lines.map((line) => JSON.parse(line));
      setRawLichessGames(games);
    } catch (err) {
      console.error("Failed to fetch Lichess games:", err);
    } finally {
      setLoadingLichessGames(false);
    }
  }, [username, rawLichessGames, loadingLichessGames, isPGNMode]);

  // Drill-down: memoize converted games
  const pgnDrilldownGames = useMemo(() => {
    if (!isPGNMode || !otbProfile?.games) return undefined;
    return otbGamesToDrilldown(otbProfile.games, username);
  }, [isPGNMode, otbProfile, username]);

  const lichessDrilldownGames = useMemo(() => {
    if (!rawLichessGames) return undefined;
    return lichessGamesToDrilldown(rawLichessGames, username);
  }, [rawLichessGames, username]);

  // Build opening coverage map from raw Lichess games
  const coverageByOpening = useMemo(() => {
    if (!rawLichessGames) return undefined;
    const map = new Map<string, { analyzed: number; total: number }>();
    for (const g of rawLichessGames) {
      if (!g.opening || g.variant !== "standard") continue;
      const family = openingFamily(g.opening.name);
      const entry = map.get(family) || { analyzed: 0, total: 0 };
      entry.total++;
      if (g.analysis && g.analysis.length > 0) entry.analyzed++;
      map.set(family, entry);
    }
    return map;
  }, [rawLichessGames]);

  // Handle upgrade request
  const handleUpgrade = useCallback(
    async (mode: EvalMode) => {
      // Abort any existing computation
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setIsUpgrading(true);
      setUpgradeProgress(null);
      setUpgradeComplete(false);
      computedEvalsRef.current = [];

      try {
        // Lazy-fetch game moves from bot-data API
        const sinceMs = TIME_RANGES.find(t => t.key === timeRange)?.ms;
        const sinceVal = sinceMs ? Date.now() - sinceMs : undefined;
        let query =
          selectedSpeeds.length > 0
            ? `?speeds=${encodeURIComponent(selectedSpeeds.join(","))}`
            : "";
        if (sinceVal) query += `${query ? "&" : "?"}since=${sinceVal}`;
        const res = await fetch(
          `/api/bot-data/${encodeURIComponent(username)}${query}`
        );
        if (!res.ok || abort.signal.aborted) {
          setIsUpgrading(false);
          return;
        }

        const botData = await res.json();
        const allGameMoves: Array<{
          moves: string;
          playerColor: "white" | "black";
          hasEvals: boolean;
        }> = botData.gameMoves || [];

        setTotalGameCount(allGameMoves.length);

        // Filter to games WITHOUT evals — don't re-evaluate what Lichess already has
        const unevaluated = allGameMoves.filter((g) => !g.hasEvals);

        if (unevaluated.length === 0) {
          // All games already have evals — show brief completion
          setUpgradeProgress({
            gamesComplete: allGameMoves.length,
            totalGames: allGameMoves.length,
            pct: 100,
          });
          setUpgradeComplete(true);
          setIsUpgrading(false);
          return;
        }

        // Set initial progress immediately so the UI shows feedback
        setUpgradeProgress({
          gamesComplete: 0,
          totalGames: unevaluated.length,
          pct: 0,
        });

        // Initialize Stockfish engine if needed
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

        // Track the base error profile (from Lichess evals) for merging
        const baseProfile = filteredData?.errorProfile;

        const evalData = await batchEvaluateGames(
          evalEngineRef.current,
          unevaluated,
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
          abort.signal
        );

        if (abort.signal.aborted) return;

        // Build error profile from computed evals
        const computedProfile = buildErrorProfileFromEvals(evalData);
        computedEvalsRef.current = evalData;

        // Merge with existing Lichess-based profile
        const merged =
          baseProfile && baseProfile.gamesAnalyzed > 0
            ? mergeErrorProfiles([baseProfile, computedProfile])
            : computedProfile;

        setEnhancedErrorProfile(merged);
        setUpgradeComplete(true);

        // Recalculate weaknesses and prep tips with enhanced error data
        if (filteredData) {
          const updatedWeaknesses = detectWeaknessesFromErrorProfile(
            merged,
            filteredData.weaknesses
          );
          setEnhancedWeaknesses(updatedWeaknesses);

          const updatedTips = generatePrepTips(
            updatedWeaknesses,
            filteredData.openings,
            filteredData.style
          );
          setEnhancedPrepTips(updatedTips);
        }

        // Cache in sessionStorage
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
    [username, selectedSpeeds, timeRange, filteredData]
  );

  // Cancel an in-progress upgrade
  const handleCancelUpgrade = useCallback(() => {
    abortRef.current?.abort();
    setIsUpgrading(false);
    setUpgradeProgress(null);
  }, []);

  // Determine displayed error profile: enhanced if available, otherwise base
  const displayedErrorProfile =
    enhancedErrorProfile || filteredData?.errorProfile;

  // Total game count for upgrade UI
  const displayedTotalGames =
    totalGameCount ?? filteredData?.games ?? undefined;

  const handlePracticeClick = useCallback(() => {
    if (isUpgrading) {
      setShowPlayConfirm(true);
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
    const sinceMs = TIME_RANGES.find(t => t.key === timeRange)?.ms;
    const since = sinceMs ? Date.now() - sinceMs : undefined;
    let playUrl = `/play/${encodeURIComponent(username)}?speeds=${selectedSpeeds.join(",")}`;
    if (since) playUrl += `&since=${since}`;
    router.push(playUrl);
  }, [isUpgrading, enhancedErrorProfile, username, selectedSpeeds, timeRange, router]);

  if (fullLoading) {
    return (
      <div className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <button
            onClick={() => router.push("/")}
            className="mb-6 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            &larr; Back to search
          </button>

          {basicData ? (
            <>
              {/* Partial PlayerCard: username + ratings */}
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
                {/* Skeleton style bars */}
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

              {/* Skeleton for error profile */}
              <div className="mt-4 rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5">
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-5 rounded-md bg-zinc-700/30 animate-pulse" />
                  ))}
                </div>
              </div>

              {/* Skeleton for tabs */}
              <div className="mt-8">
                <div className="flex gap-1 border-b border-zinc-800">
                  {["Openings", "Weaknesses", "Prep Tips"].map((label) => (
                    <div key={label} className="px-4 py-2.5 text-sm text-zinc-600">
                      {label}
                    </div>
                  ))}
                </div>
                <div className="mt-6 space-y-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-12 rounded-lg bg-zinc-800/30 animate-pulse" />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[60vh] items-center justify-center">
              <div className="h-12 w-12 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-xl font-bold text-white mb-2">Error</h2>
          <p className="text-zinc-400 mb-4">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 transition-colors"
          >
            Try another player
          </button>
        </div>
      </div>
    );
  }

  // PGN-only mode: render from OTB profile without Lichess data
  if (isPGNMode) {
    if (!otbProfile) return null;

    const displayName = username;
    const pgnTabs: ["openings" | "weaknesses", string][] = [
      ["openings", "Openings"],
      ["weaknesses", "Weaknesses"],
    ];

    const styleEntries = [
      ["Aggression", otbProfile.style.aggression],
      ["Tactical", otbProfile.style.tactical],
      ["Positional", otbProfile.style.positional],
      ["Endgame", otbProfile.style.endgame],
    ] as const;

    return (
      <div className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex items-center justify-between">
            <button
              onClick={() => router.push("/")}
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              &larr; Back to search
            </button>
            <button
              onClick={() =>
                router.push(
                  `/play/${encodeURIComponent(username)}?source=pgn`
                )
              }
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500"
              style={{ animation: "pulse-glow 2s ease-in-out infinite" }}
            >
              Practice &#9654;
            </button>
          </div>

          {/* Player Card */}
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
            <div>
              <h2 className="text-2xl font-bold text-white">{displayName}</h2>
              <p className="text-sm text-zinc-400 mt-1">
                {otbProfile.totalGames} game
                {otbProfile.totalGames !== 1 ? "s" : ""} analyzed from PGN
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide">
                  Playing Style
                </h3>
                {otbProfile.style.sampleSize < 30 && (
                  <span className="text-xs text-zinc-500">
                    Based on {otbProfile.style.sampleSize} games
                  </span>
                )}
              </div>
              {styleEntries.map(([label, value]) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-zinc-400">{label}</span>
                  <div className="flex-1 h-2 rounded-full bg-zinc-700 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        value >= 75
                          ? "bg-green-500"
                          : value >= 50
                            ? "bg-yellow-500"
                            : value >= 25
                              ? "bg-orange-500"
                              : "bg-red-500"
                      }`}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm font-mono text-zinc-300">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Add more PGN games */}
          <OTBUploader
            username={displayName}
            onProfileReady={handleOtbReady}
            existingProfile={otbProfile}
            onClear={handleOtbClear}
          />

          {/* Tabs */}
          <div className="mt-8">
            <div className="flex gap-1 border-b border-zinc-800">
              {pgnTabs.map(([key, label]) => (
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
              {activeTab === "openings" && (
                <OpeningsTab
                  white={otbProfile.openings.white}
                  black={otbProfile.openings.black}
                  games={pgnDrilldownGames}
                  onAnalyzeGame={handleAnalyzeGame}
                />
              )}
              {activeTab === "weaknesses" && (
                <WeaknessesTab
                  weaknesses={otbProfile.weaknesses}
                  username={displayName}
                  speeds=""
                />
              )}
            </div>
          </div>

          {/* Practice button */}
          <div className="mt-8 flex flex-col items-center">
            <button
              onClick={() =>
                router.push(
                  `/play/${encodeURIComponent(username)}?source=pgn`
                )
              }
              className="rounded-lg bg-green-600 px-6 py-3 text-lg font-medium text-white transition-colors hover:bg-green-500"
            >
              Practice against {displayName}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!profile || !filteredData) return null;

  const availableSpeeds = Object.keys(profile.bySpeed).sort(
    (a, b) => SPEED_ORDER.indexOf(a) - SPEED_ORDER.indexOf(b)
  );

  const tabs: [Tab, string][] = [
    ["openings", "Openings"],
    ["weaknesses", "Weaknesses"],
    ["prep", "Prep Tips"],
    ...(otbProfile ? [["otb", "OTB Games"] as [Tab, string]] : []),
  ];

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => router.push("/")}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            &larr; Back to search
          </button>
          <button
            onClick={handlePracticeClick}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500"
            style={{ animation: "pulse-glow 2s ease-in-out infinite" }}
          >
            Practice &#9654;
          </button>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* Speed Filter */}
          {availableSpeeds.length >= 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 uppercase tracking-wide mr-1">
                Speed
              </span>
              {availableSpeeds.map((speed) => {
                const data = profile.bySpeed[speed];
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
                      {data.games}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Time Range Filter */}
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
        </div>

        {/* Player Card */}
        <PlayerCard profile={profile} filteredGames={filteredData.games} />

        {/* Error Profile */}
        {displayedErrorProfile &&
          (displayedErrorProfile.gamesAnalyzed > 0 || isUpgrading) && (
            <div className="mt-4">
              <ErrorProfileCard
                errorProfile={displayedErrorProfile}
                totalGames={displayedTotalGames}
                onUpgrade={handleUpgrade}
                onCancel={handleCancelUpgrade}
                upgradeProgress={upgradeProgress}
                isUpgrading={isUpgrading}
                upgradeComplete={upgradeComplete}
              />
            </div>
          )}

        {/* OTB PGN Upload */}
        <OTBUploader
          username={username}
          onProfileReady={handleOtbReady}
          existingProfile={otbProfile}
          onClear={handleOtbClear}
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
            {activeTab === "openings" && (
              <OpeningsTab
                white={filteredData.openings.white}
                black={filteredData.openings.black}
                games={lichessDrilldownGames}
                onAnalyzeGame={handleAnalyzeGame}
                onRequestGames={fetchLichessRawGames}
                loadingGames={loadingLichessGames}
                coverageByOpening={coverageByOpening}
              />
            )}
            {activeTab === "weaknesses" && (
              <WeaknessesTab
                weaknesses={enhancedWeaknesses ?? filteredData.weaknesses}
                username={username}
                speeds={selectedSpeeds.join(",")}
              />
            )}
            {activeTab === "prep" && <PrepTipsTab tips={enhancedPrepTips ?? filteredPrepTips} />}
            {activeTab === "otb" && otbProfile && (
              <OTBAnalysisTab profile={otbProfile} />
            )}
          </div>
        </div>

        {/* Practice button */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            onClick={handlePracticeClick}
            className="rounded-lg bg-green-600 px-6 py-3 text-lg font-medium text-white transition-colors hover:bg-green-500"
          >
            Practice against {profile.username}
          </button>
          <p className="text-xs text-zinc-500 mt-1">
            Bot trained on {filteredData.games} {selectedSpeeds.join(" + ")} game{filteredData.games !== 1 ? "s" : ""}
            {timeRange !== "all" ? ` from ${TIME_RANGES.find(t => t.key === timeRange)?.label?.toLowerCase()}` : ""}
          </p>

          {showPlayConfirm && isUpgrading && (
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/80 p-4 text-center max-w-md animate-in fade-in duration-200">
              <p className="text-sm text-zinc-300 mb-3">
                Analysis is {upgradeProgress?.pct ?? 0}% complete. The bot won&apos;t
                include the new data until analysis finishes.
              </p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => {
                    setShowPlayConfirm(false);
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
                    const sinceMs = TIME_RANGES.find(t => t.key === timeRange)?.ms;
                    const since = sinceMs ? Date.now() - sinceMs : undefined;
                    let playUrl = `/play/${encodeURIComponent(username)}?speeds=${selectedSpeeds.join(",")}`;
                    if (since) playUrl += `&since=${since}`;
                    router.push(playUrl);
                  }}
                  className="rounded-lg border border-zinc-600/40 bg-zinc-700/30 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700/50"
                >
                  Play now with current data
                </button>
                <button
                  onClick={() => setShowPlayConfirm(false)}
                  className="rounded-lg border border-green-600/40 bg-green-600/10 px-4 py-2 text-sm font-medium text-green-400 transition-colors hover:bg-green-600/20"
                >
                  Wait for analysis
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

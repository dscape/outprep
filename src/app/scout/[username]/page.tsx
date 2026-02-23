"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { PlayerProfile, OTBProfile, StyleMetrics, OpeningStats, Weakness } from "@/lib/types";
import PlayerCard from "@/components/PlayerCard";
import OpeningsTab from "@/components/OpeningsTab";
import WeaknessesTab from "@/components/WeaknessesTab";
import PrepTipsTab from "@/components/PrepTipsTab";
import OTBUploader from "@/components/OTBUploader";
import OTBAnalysisTab from "@/components/OTBAnalysisTab";
import LoadingStages from "@/components/LoadingStages";

type Tab = "openings" | "weaknesses" | "prep" | "otb";

interface FilteredData {
  style: StyleMetrics;
  openings: { white: OpeningStats[]; black: OpeningStats[] };
  weaknesses: Weakness[];
  games: number;
}

function mergeOpenings(
  openingsSets: { white: OpeningStats[]; black: OpeningStats[] }[]
): { white: OpeningStats[]; black: OpeningStats[] } {
  const mergeColor = (lists: OpeningStats[][]): OpeningStats[] => {
    const map = new Map<string, { eco: string; name: string; wins: number; draws: number; losses: number; total: number }>();
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
    const totalGames = Array.from(map.values()).reduce((sum, e) => sum + e.total, 0);
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

function mergeSpeedProfiles(profile: PlayerProfile, speeds: string[]): FilteredData {
  let totalGames = 0;
  let aggSum = 0, tacSum = 0, posSum = 0, endSum = 0;

  for (const s of speeds) {
    const sp = profile.bySpeed[s];
    if (!sp) continue;
    totalGames += sp.games;
    aggSum += sp.style.aggression * sp.games;
    tacSum += sp.style.tactical * sp.games;
    posSum += sp.style.positional * sp.games;
    endSum += sp.style.endgame * sp.games;
  }

  const style: StyleMetrics = totalGames > 0
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
    .filter((o): o is { white: OpeningStats[]; black: OpeningStats[] } => !!o);
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

  return { style, openings, weaknesses, games: totalGames };
}

const SPEED_ORDER = ["bullet", "blitz", "rapid", "classical"];

export default function ScoutPage() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("openings");
  const [selectedSpeeds, setSelectedSpeeds] = useState<string[]>([]);
  const [otbProfile, setOtbProfile] = useState<OTBProfile | null>(null);

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

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch(`/api/profile/${encodeURIComponent(username)}`);

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Failed to load profile");
          setLoading(false);
          return;
        }

        const data = await res.json();
        setProfile(data);
        // Default: all available speeds selected
        setSelectedSpeeds(
          Object.keys(data.bySpeed || {}).sort(
            (a, b) => SPEED_ORDER.indexOf(a) - SPEED_ORDER.indexOf(b)
          )
        );
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [username]);

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
      setActiveTab("otb");
      // Persist to sessionStorage
      try {
        sessionStorage.setItem(`otb:${username}`, JSON.stringify(otb));
      } catch {
        // Storage full — non-fatal
      }
    },
    [username]
  );

  const handleOtbClear = useCallback(() => {
    setOtbProfile(null);
    if (activeTab === "otb") setActiveTab("openings");
    try {
      sessionStorage.removeItem(`otb:${username}`);
    } catch {
      // Ignore
    }
  }, [username, activeTab]);

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

  if (loading) {
    return (
      <div className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <button
            onClick={() => router.push("/")}
            className="mb-6 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            &larr; Back to search
          </button>
          <LoadingStages />
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
        <button
          onClick={() => router.push("/")}
          className="mb-6 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          &larr; Back to search
        </button>

        {/* Speed Filter */}
        {availableSpeeds.length > 1 && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-zinc-500 uppercase tracking-wide mr-1">
              Time Control
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
                  <span className={isActive ? "text-green-200" : "text-zinc-600"}>
                    {data.games}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Player Card */}
        <PlayerCard profile={profile} filteredGames={filteredData.games} />

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
              />
            )}
            {activeTab === "weaknesses" && (
              <WeaknessesTab weaknesses={filteredData.weaknesses} />
            )}
            {activeTab === "prep" && (
              <PrepTipsTab tips={profile.prepTips} />
            )}
            {activeTab === "otb" && otbProfile && (
              <OTBAnalysisTab profile={otbProfile} />
            )}
          </div>
        </div>

        {/* Practice button */}
        <div className="mt-8 flex justify-center">
          <button
            onClick={() =>
              router.push(
                `/play/${encodeURIComponent(username)}?speeds=${selectedSpeeds.join(",")}`
              )
            }
            className="rounded-lg bg-green-600 px-6 py-3 text-lg font-medium text-white transition-colors hover:bg-green-500"
          >
            Practice against {profile.username}
          </button>
        </div>
      </div>
    </div>
  );
}

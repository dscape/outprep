"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PlayerProfile } from "@/lib/types";
import PlayerCard from "@/components/PlayerCard";
import OpeningsTab from "@/components/OpeningsTab";
import WeaknessesTab from "@/components/WeaknessesTab";
import PrepTipsTab from "@/components/PrepTipsTab";
import LoadingStages from "@/components/LoadingStages";

type Tab = "openings" | "weaknesses" | "prep";

export default function ScoutPage() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("openings");

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
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [username]);

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

  if (!profile) return null;

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => router.push("/")}
          className="mb-6 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          &larr; Back to search
        </button>

        {/* Player Card */}
        <PlayerCard profile={profile} />

        {/* Tabs */}
        <div className="mt-8">
          <div className="flex gap-1 border-b border-zinc-800">
            {([
              ["openings", "Openings"],
              ["weaknesses", "Weaknesses"],
              ["prep", "Prep Tips"],
            ] as [Tab, string][]).map(([key, label]) => (
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
                white={profile.openings.white}
                black={profile.openings.black}
              />
            )}
            {activeTab === "weaknesses" && (
              <WeaknessesTab weaknesses={profile.weaknesses} />
            )}
            {activeTab === "prep" && (
              <PrepTipsTab tips={profile.prepTips} />
            )}
          </div>
        </div>

        {/* Practice button */}
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => router.push(`/play/${encodeURIComponent(username)}`)}
            className="rounded-lg bg-green-600 px-6 py-3 text-lg font-medium text-white transition-colors hover:bg-green-500"
          >
            Practice against {profile.username}
          </button>
        </div>
      </div>
    </div>
  );
}

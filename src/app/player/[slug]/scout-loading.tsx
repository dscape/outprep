"use client";

import { useRouter } from "next/navigation";
import { useScout } from "./scout-context";

export default function ScoutLoading() {
  const router = useRouter();
  const { basicData, profile, fullLoading, error, isPGNMode, platform, partialData } = useScout();

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

  // Phase 2: basic data arrived, full profile still loading
  if (basicData && !profile && fullLoading && !isPGNMode) {
    const hasPartial = !!partialData;
    return (
      <div className="mt-4 rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-4">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-green-500 border-t-transparent animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm text-zinc-300 font-medium">
              {hasPartial
                ? `Analyzing play style for ${basicData.username}...`
                : `Building profile for ${basicData.username}...`}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {hasPartial
                ? "Openings loaded — computing style, weaknesses, and prep tips"
                : "Analyzing game patterns and openings"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Phase 1: no data at all for online players
  if (!basicData && !profile && fullLoading && !isPGNMode && platform !== "fide") {
    const platformLabel = platform === "chesscom" ? "Chess.com" : "Lichess";
    return (
      <div className="mt-8 flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
        <p className="text-sm text-zinc-400">Fetching games from {platformLabel}...</p>
      </div>
    );
  }

  return null;
}

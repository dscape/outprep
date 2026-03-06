"use client";

import { useRouter } from "next/navigation";
import { useScout } from "./scout-context";

export default function ScoutLoading() {
  const router = useRouter();
  const { basicData, profile, fullLoading, error, isPGNMode, platform } = useScout();

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

  // Show spinner only when no data at all for online players
  if (!basicData && !profile && fullLoading && !isPGNMode && platform !== "fide") {
    return (
      <div className="mt-8 flex justify-center">
        <div className="h-12 w-12 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return null;
}

"use client";

import { useRouter } from "next/navigation";
import type { Platform } from "@/lib/platform-utils";
import { useScout } from "./scout-context";
import { TIME_RANGES } from "@/lib/profile-merge";

interface PracticeButtonProps {
  playerName: string;
  slug: string;
  platform: Platform;
  /** FIDE rating from DB — pre-seeds sessionStorage so the play page shows the correct rating */
  fideRating?: number;
}

/** Extract a short display name: "Carlsen, Magnus" → "Magnus", "hikaru" → "hikaru" */
function shortName(name: string): string {
  if (name.includes(",")) {
    const parts = name.split(",").map((s) => s.trim());
    return parts[1] || parts[0];
  }
  return name;
}

export default function PracticeButton({ playerName, slug, platform, fideRating }: PracticeButtonProps) {
  const router = useRouter();
  const { selectedSpeeds, timeRange, filteredData, profile } = useScout();

  const handleClick = () => {
    // Pre-seed play-profile cache so the play page has the correct rating immediately
    if (fideRating) {
      try {
        sessionStorage.setItem(
          `play-profile:${slug}`,
          JSON.stringify({ username: playerName, fideEstimate: { rating: fideRating, confidence: 100 } })
        );
      } catch {
        // Storage full — non-fatal
      }
    }

    const prefix = platform === "chesscom" ? "chesscom:" : platform === "fide" ? "fide:" : platform === "pgn" ? "pgn:" : "";
    const params = new URLSearchParams();
    if (selectedSpeeds.length > 0) params.set("speeds", selectedSpeeds.join(","));
    if (timeRange !== "all") {
      const sinceMs = TIME_RANGES.find(t => t.key === timeRange)?.ms;
      if (sinceMs) params.set("since", String(Date.now() - sinceMs));
    }
    // Pass game count and time range label for bot data label
    const gameCount = filteredData?.games ?? profile?.analyzedGames ?? 0;
    if (gameCount > 0) params.set("gameCount", String(gameCount));
    const rangeEntry = TIME_RANGES.find(t => t.key === timeRange);
    if (rangeEntry) params.set("timeRangeLabel", rangeEntry.label);
    const qs = params.toString() ? `?${params}` : "";
    router.push(`/play/${prefix}${encodeURIComponent(slug)}${qs}`);
  };

  return (
    <>
      <style>{`
        @keyframes cta-enter {
          0% {
            opacity: 0;
            transform: scale(0.9) translateY(6px);
            filter: blur(6px) brightness(1.8);
            box-shadow: 0 0 30px 6px rgba(168, 85, 247, 0.5),
                        0 0 60px 12px rgba(99, 102, 241, 0.25);
          }
          50% {
            opacity: 1;
            transform: scale(1.04) translateY(-2px);
            filter: blur(0) brightness(1.2);
            box-shadow: 0 0 20px 3px rgba(168, 85, 247, 0.35),
                        0 0 40px 6px rgba(99, 102, 241, 0.15);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
            filter: blur(0) brightness(1);
            box-shadow: 0 4px 12px -2px rgba(168, 85, 247, 0.2);
          }
        }
      `}</style>
      <button
        onClick={handleClick}
        className="relative rounded-lg px-5 py-2 text-sm font-semibold text-white transition-all duration-300 hover:brightness-110 hover:shadow-lg hover:shadow-purple-500/25 active:scale-[0.97]"
        style={{
          backgroundImage: "linear-gradient(to right, #6366f1, #a855f7, #d946ef)",
          animation: "cta-enter 1.6s cubic-bezier(0.22, 1, 0.36, 1) 0.3s both",
        }}
      >
        Play {shortName(playerName)}
      </button>
    </>
  );
}

"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface PracticeLoaderProps {
  slug: string;
  playerName: string;
}

export default function PracticeLoader({
  slug,
  playerName,
}: PracticeLoaderProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePractice = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch pre-built OTB profile from server (parsing + analysis done server-side)
      const res = await fetch(`/api/fide-practice/${encodeURIComponent(slug)}?name=${encodeURIComponent(playerName)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load games");
      }

      const profile = await res.json();

      // Store compact profile in sessionStorage (PGN text already stripped server-side)
      sessionStorage.setItem(
        `pgn-import:${playerName}`,
        JSON.stringify(profile)
      );

      // Navigate to scout page in PGN mode
      router.push(
        `/scout/${encodeURIComponent(playerName)}?source=pgn`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load games");
      setLoading(false);
    }
  }, [slug, playerName, router]);

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handlePractice}
        disabled={loading}
        className="rounded-lg bg-green-600 px-6 py-3 text-lg font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg
              className="h-5 w-5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading games...
          </span>
        ) : (
          `Practice Against ${playerName}`
        )}
      </button>
      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}
    </div>
  );
}

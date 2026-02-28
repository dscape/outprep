"use client";

import { useState, useCallback } from "react";
import OpeningsTab from "@/components/OpeningsTab";
import type { OpeningStats } from "@/lib/types";
import type { GameForDrilldown } from "@/lib/game-helpers";
import { fideGamesToDrilldown } from "@/lib/game-helpers";

interface FideOpeningsProps {
  white: OpeningStats[];
  black: OpeningStats[];
  playerSlug: string;
  playerName: string;
}

export default function FideOpenings({
  white,
  black,
  playerSlug,
  playerName,
}: FideOpeningsProps) {
  const [games, setGames] = useState<GameForDrilldown[] | undefined>();
  const [loading, setLoading] = useState(false);

  const fetchGames = useCallback(async () => {
    if (games || loading) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/fide-games/${encodeURIComponent(playerSlug)}`
      );
      if (!res.ok) throw new Error("Failed to load games");
      const data = await res.json();
      const rawPgns: string[] = data.games || [];
      const converted = fideGamesToDrilldown(rawPgns, playerName);
      setGames(converted);
    } catch {
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, [playerSlug, playerName, games, loading]);

  const handleAnalyze = useCallback((game: GameForDrilldown) => {
    // Navigate to the game page if we have a valid slug
    if (game.id && !game.id.startsWith("fide-game-")) {
      window.location.href = `/game/${game.id}`;
    }
  }, []);

  return (
    <OpeningsTab
      white={white}
      black={black}
      games={games}
      onRequestGames={fetchGames}
      loadingGames={loading}
      onAnalyzeGame={handleAnalyze}
    />
  );
}

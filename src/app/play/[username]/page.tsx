"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { PlayerProfile, ErrorProfile, MoveEval, AnalysisSummary } from "@/lib/types";
import { OpeningTrie } from "@/lib/engine/opening-trie";
import ChessBoard from "@/components/ChessBoard";

interface BotData {
  errorProfile: ErrorProfile;
  whiteTrie: OpeningTrie;
  blackTrie: OpeningTrie;
  gameMoves: Array<{ moves: string; playerColor: "white" | "black"; hasEvals: boolean }>;
}

export default function PlayPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const username = params.username as string;
  const speeds = searchParams.get("speeds") || "";

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [botData, setBotData] = useState<BotData | null>(null);
  const [playerColor, setPlayerColor] = useState<"white" | "black" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [enhancedErrorProfile, setEnhancedErrorProfile] = useState<ErrorProfile | null>(null);

  useEffect(() => {
    // Load enhanced profile from sessionStorage (computed on scout page)
    try {
      const cached = sessionStorage.getItem(`enhanced-profile:${username}`);
      if (cached) {
        setEnhancedErrorProfile(JSON.parse(cached));
      }
    } catch {
      // Ignore
    }

    async function load() {
      try {
        const query = speeds ? `?speeds=${encodeURIComponent(speeds)}` : "";
        const [profileRes, botRes] = await Promise.all([
          fetch(`/api/profile/${encodeURIComponent(username)}`),
          fetch(`/api/bot-data/${encodeURIComponent(username)}${query}`),
        ]);

        if (!profileRes.ok) {
          const data = await profileRes.json();
          setError(data.error || "Failed to load profile");
          setLoading(false);
          return;
        }

        const profileData = await profileRes.json();
        setProfile(profileData);

        if (botRes.ok) {
          const data: BotData = await botRes.json();
          setBotData(data);
        }
      } catch {
        setError("Failed to load game data.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [username, speeds]);

  const handleGameEnd = useCallback((
    pgn: string,
    result: string,
    precomputedAnalysis?: { moves: MoveEval[]; summary: AnalysisSummary }
  ) => {
    const gameId = uuidv4();

    sessionStorage.setItem(
      `game:${gameId}`,
      JSON.stringify({
        pgn,
        result,
        playerColor,
        opponentUsername: username,
        opponentFideEstimate: profile?.fideEstimate.rating,
        ...(precomputedAnalysis ? {
          precomputedMoves: precomputedAnalysis.moves,
          precomputedSummary: precomputedAnalysis.summary,
        } : {}),
      })
    );

    router.push(`/analysis/${gameId}`);
  }, [playerColor, username, profile, router]);

  // Use enhanced profile if available, otherwise fall back to bot-data profile
  const activeErrorProfile = enhancedErrorProfile || botData?.errorProfile || null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 mx-auto rounded-full border-2 border-green-500 border-t-transparent animate-spin mb-4" />
          <p className="text-zinc-400">Loading opponent data...</p>
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
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700"
          >
            Back to search
          </button>
        </div>
      </div>
    );
  }

  // Color selection screen
  if (!playerColor) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">
            Play against {profile?.username}
          </h2>
          <p className="text-zinc-400 mb-8">
            ~{profile?.fideEstimate.rating} FIDE estimated
          </p>

          <p className="text-sm text-zinc-500 mb-4">Choose your color</p>

          <div className="flex gap-4 justify-center">
            <button
              onClick={() => setPlayerColor("white")}
              className="group relative rounded-xl border border-zinc-700 bg-zinc-800/50 p-6 transition-all hover:border-green-500 hover:bg-zinc-800"
            >
              <div className="text-5xl mb-2">&#9812;</div>
              <span className="text-sm font-medium text-zinc-300 group-hover:text-white">
                White
              </span>
            </button>
            <button
              onClick={() => setPlayerColor("black")}
              className="group relative rounded-xl border border-zinc-700 bg-zinc-800/50 p-6 transition-all hover:border-green-500 hover:bg-zinc-800"
            >
              <div className="text-5xl mb-2">&#9818;</div>
              <span className="text-sm font-medium text-zinc-300 group-hover:text-white">
                Black
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Bot color is opposite of player color
  const botColor = playerColor === "white" ? "black" : "white";

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => router.push(`/scout/${encodeURIComponent(username)}`)}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            &larr; Back to scout
          </button>
          <h1 className="text-lg font-medium text-white">
            vs {profile?.username}
          </h1>
        </div>

        <ChessBoard
          playerColor={playerColor}
          opponentUsername={profile?.username || username}
          fideEstimate={profile?.fideEstimate.rating || 1500}
          errorProfile={activeErrorProfile}
          openingTrie={
            botColor === "white" ? botData?.whiteTrie || null : botData?.blackTrie || null
          }
          onGameEnd={handleGameEnd}
        />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { ErrorProfile, MoveEval, AnalysisSummary } from "@/lib/types";
import { OpeningTrie } from "@/lib/engine/opening-trie";
import { getOpeningMoves } from "@/lib/analysis/eco-lookup";
import ChessBoard from "@/components/ChessBoard";

interface BotData {
  errorProfile: ErrorProfile;
  whiteTrie: OpeningTrie;
  blackTrie: OpeningTrie;
  gameMoves: Array<{ moves: string; playerColor: "white" | "black"; hasEvals: boolean }>;
}

/** Minimal profile info needed for the play page */
interface PlayProfile {
  username: string;
  fideEstimate: { rating: number };
}

export default function PlayPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const username = params.username as string;
  const speeds = searchParams.get("speeds") || "";
  const eco = searchParams.get("eco") || "";
  const openingName = searchParams.get("openingName") || "";

  const [profile, setProfile] = useState<PlayProfile | null>(null);
  const [botData, setBotData] = useState<BotData | null>(null);
  const [playerColor, setPlayerColor] = useState<"white" | "black" | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [botDataReady, setBotDataReady] = useState(false);
  const [error, setError] = useState("");
  const [enhancedErrorProfile, setEnhancedErrorProfile] = useState<ErrorProfile | null>(null);
  const [startingMoves, setStartingMoves] = useState<string[] | null>(null);
  const [loadingOpening, setLoadingOpening] = useState(false);

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

    // Try cached profile from sessionStorage (stored by scout page) for instant display
    let profileFromCache = false;
    try {
      const cached = sessionStorage.getItem(`play-profile:${username}`);
      if (cached) {
        const data = JSON.parse(cached);
        setProfile(data);
        setProfileReady(true);
        profileFromCache = true;
      }
    } catch {
      // Ignore
    }

    async function load() {
      try {
        const query = speeds ? `?speeds=${encodeURIComponent(speeds)}` : "";

        // Start bot-data fetch immediately (likely cache-hit from scout pre-warm)
        const botFetch = fetch(
          `/api/bot-data/${encodeURIComponent(username)}${query}`
        );

        // Only fetch profile API if not in sessionStorage
        if (!profileFromCache) {
          const profileRes = await fetch(
            `/api/profile/${encodeURIComponent(username)}`
          );
          if (!profileRes.ok) {
            const data = await profileRes.json();
            setError(data.error || "Failed to load profile");
            return;
          }
          const profileData = await profileRes.json();
          setProfile(profileData);
          setProfileReady(true);
        }

        // Await bot-data (user is picking color while this loads)
        const botRes = await botFetch;
        if (botRes.ok) {
          const data: BotData = await botRes.json();
          setBotData(data);
        }
        setBotDataReady(true);
      } catch {
        setError("Failed to load game data.");
      }
    }

    load();

    // Load opening moves if ECO param is present
    if (eco) {
      setLoadingOpening(true);
      getOpeningMoves(eco)
        .then((moves) => setStartingMoves(moves.length > 0 ? moves : null))
        .catch(() => {})
        .finally(() => setLoadingOpening(false));
    }
  }, [username, speeds, eco]);

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

  // Bot data label for display
  const botDataLabel = enhancedErrorProfile
    ? `Bot enhanced with Stockfish analysis`
    : `Bot based on Lichess game history`;

  // Only block on profile — show color selection ASAP
  if (!profileReady && !error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 mx-auto rounded-full border-2 border-green-500 border-t-transparent animate-spin mb-4" />
          <p className="text-zinc-400">Loading...</p>
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

  // Color selection screen — shows immediately when profile is cached
  if (!playerColor) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">
            Play against {profile?.username}
          </h2>
          <p className="text-zinc-400 mb-2">
            ~{profile?.fideEstimate.rating} FIDE estimated
          </p>
          <p className="text-xs text-zinc-600 mb-4">
            {botDataLabel}
          </p>
          {openingName && (
            <p className="text-sm text-green-400 mb-6">
              Practicing: {openingName}
              {eco && <span className="text-zinc-500 ml-1">({eco})</span>}
            </p>
          )}

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

  // Wait for bot data + opening before starting game
  if (!botDataReady || loadingOpening) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 mx-auto rounded-full border-2 border-green-500 border-t-transparent animate-spin mb-4" />
          <p className="text-zinc-400">
            {loadingOpening ? "Loading opening position..." : "Preparing bot..."}
          </p>
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
            {openingName && (
              <span className="text-sm text-zinc-500 ml-2">
                {openingName}
              </span>
            )}
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
          startingMoves={startingMoves || undefined}
          botDataLabel={botDataLabel}
        />
      </div>
    </div>
  );
}

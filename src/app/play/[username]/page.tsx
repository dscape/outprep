"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { MoveEval, AnalysisSummary, OTBProfile } from "@/lib/types";
import type { ErrorProfile, OpeningTrie, GameRecord } from "@outprep/engine";
import { buildOpeningTrie } from "@outprep/engine";
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
  const rawUsername = params.username as string;
  const username = decodeURIComponent(rawUsername);
  const speeds = searchParams.get("speeds") || "";
  const eco = searchParams.get("eco") || "";
  const openingName = searchParams.get("openingName") || "";
  const opponentWeaknessColor = searchParams.get("color") as "white" | "black" | null;

  // Load cached profile from sessionStorage (stored by scout page) for instant display
  const cachedProfile = useMemo<{ profile: PlayProfile; ready: boolean } | null>(() => {
    try {
      if (typeof window === "undefined") return null;
      const cached = sessionStorage.getItem(`play-profile:${username}`);
      if (cached) return { profile: JSON.parse(cached), ready: true };
    } catch {
      // Ignore
    }
    return null;
  }, [username]);

  const [profile, setProfile] = useState<PlayProfile | null>(cachedProfile?.profile ?? null);
  const [botData, setBotData] = useState<BotData | null>(null);
  // Auto-select color when practicing a weakness: play the opposite of the opponent's weak color
  const [playerColor, setPlayerColor] = useState<"white" | "black" | null>(
    opponentWeaknessColor ? (opponentWeaknessColor === "white" ? "black" : "white") : null
  );
  const [profileReady, setProfileReady] = useState(cachedProfile?.ready ?? false);
  const [botDataReady, setBotDataReady] = useState(false);
  const [error, setError] = useState("");
  const [enhancedErrorProfile] = useState<ErrorProfile | null>(() => {
    // Load enhanced profile from sessionStorage (computed on scout page)
    try {
      const cached = typeof window !== "undefined"
        ? sessionStorage.getItem(`enhanced-profile:${username}`)
        : null;
      if (cached) return JSON.parse(cached) as ErrorProfile;
    } catch {
      // Ignore
    }
    return null;
  });
  const [startingMoves, setStartingMoves] = useState<string[] | null>(null);
  const [loadingOpening, setLoadingOpening] = useState(!!eco);

  useEffect(() => {
    const profileFromCache = !!cachedProfile;

    async function load() {
      try {
        const query = speeds ? `?speeds=${encodeURIComponent(speeds)}` : "";

        // Start bot-data fetch immediately (likely cache-hit from scout pre-warm)
        const botFetch = fetch(
          `/api/bot-data/${encodeURIComponent(username)}${query}`
        );

        // Only fetch profile API if not in sessionStorage
        if (!profileFromCache) {
          try {
            const profileRes = await fetch(
              `/api/profile/${encodeURIComponent(username)}`
            );
            if (profileRes.ok) {
              const profileData = await profileRes.json();
              setProfile(profileData);
              setProfileReady(true);
            } else {
              // PGN user: no Lichess profile, use username as-is
              setProfile({ username, fideEstimate: { rating: 0 } });
              setProfileReady(true);
            }
          } catch {
            // Network error — still try to proceed for PGN users
            setProfile({ username, fideEstimate: { rating: 0 } });
            setProfileReady(true);
          }
        }

        // Await bot-data (user is picking color while this loads)
        const botRes = await botFetch;
        if (botRes.ok) {
          const data: BotData = await botRes.json();
          setBotData(data);
        } else {
          // Fallback: build bot data client-side from PGN-imported games
          const pgnBotData = buildBotDataFromPGN(username);
          if (pgnBotData) setBotData(pgnBotData);
        }
        setBotDataReady(true);
      } catch {
        setError("Failed to load game data.");
      }
    }

    load();
  }, [username, speeds, cachedProfile]);

  // Load opening moves if ECO param is present (separate effect to avoid sync setState)
  useEffect(() => {
    if (!eco) return;
    let cancelled = false;
    getOpeningMoves(eco)
      .then((moves) => {
        if (!cancelled) setStartingMoves(moves.length > 0 ? moves : null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingOpening(false);
      });
    return () => { cancelled = true; };
  }, [eco]);

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
          {!!profile?.fideEstimate.rating && (
            <p className="text-zinc-400 mb-2">
              ~{profile.fideEstimate.rating} FIDE estimated
            </p>
          )}
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

/**
 * Build BotData client-side from PGN-imported OTB games stored in sessionStorage.
 * Used as a fallback when the Lichess bot-data API is not available.
 */
function buildBotDataFromPGN(username: string): BotData | null {
  try {
    const stored = sessionStorage.getItem(`pgn-import:${username}`);
    if (!stored) return null;

    const otb: OTBProfile = JSON.parse(stored);

    // Convert OTB games to GameRecord format for trie building
    const gameRecords: GameRecord[] = (otb.games || [])
      .filter((g) => g.moves)
      .map((g) => {
        const playerName = username.toLowerCase();
        const isWhite = g.white.toLowerCase().includes(playerName);
        return {
          moves: g.moves,
          playerColor: (isWhite ? "white" : "black") as "white" | "black",
          result: g.result === "1-0" ? "white" as const
            : g.result === "0-1" ? "black" as const
            : "draw" as const,
        };
      });

    const whiteTrie = buildOpeningTrie(gameRecords, "white");
    const blackTrie = buildOpeningTrie(gameRecords, "black");

    // Empty error profile — no eval data from PGN
    const emptyPhase = { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 };
    const errorProfile: ErrorProfile = {
      opening: { ...emptyPhase },
      middlegame: { ...emptyPhase },
      endgame: { ...emptyPhase },
      overall: { ...emptyPhase },
      gamesAnalyzed: 0,
    };

    const gameMoves = gameRecords.map((g) => ({
      moves: g.moves,
      playerColor: g.playerColor,
      hasEvals: false,
    }));

    return { errorProfile, whiteTrie, blackTrie, gameMoves };
  } catch {
    return null;
  }
}

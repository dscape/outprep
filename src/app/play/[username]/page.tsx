"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { v4 as uuidv4 } from "uuid";
import { MoveEval, AnalysisSummary, OTBProfile } from "@/lib/types";
import type { ErrorProfile, OpeningTrie, GameRecord, StyleMetrics } from "@outprep/engine";
import { buildOpeningTrie } from "@outprep/engine";
import { getOpeningMoves } from "@/lib/analysis/eco-lookup";
import { parsePlatformUsername, buildScoutUrl } from "@/lib/platform-utils";
import { matchesPlayerName } from "@outprep/engine";

const ChessBoard = dynamic(() => import("@/components/ChessBoard"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center" style={{ minHeight: 400 }}>
      <div className="text-center">
        <div className="h-8 w-8 mx-auto rounded-full border-2 border-green-500 border-t-transparent animate-spin mb-3" />
        <p className="text-sm text-zinc-400">Preparing chess engine...</p>
      </div>
    </div>
  ),
});

interface BotData {
  errorProfile: ErrorProfile;
  whiteTrie: OpeningTrie;
  blackTrie: OpeningTrie;
  styleMetrics: StyleMetrics;
}

/** Minimal profile info needed for the play page */
interface PlayProfile {
  username: string;
  fideEstimate: { rating: number };
}

type LoadingStage = "profile" | "fetching" | "analyzing" | "building" | "ready";

const STAGE_LABELS: Record<LoadingStage, { title: string; detail: string }> = {
  profile: { title: "Loading player data...", detail: "Fetching ratings and profile" },
  fetching: { title: "Fetching game history...", detail: "Downloading games from platform" },
  analyzing: { title: "Analyzing games...", detail: "Computing error profile and play style" },
  building: { title: "Building opening book...", detail: "Creating opening repertoire from game history" },
  ready: { title: "Ready", detail: "" },
};

export default function PlayPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawUsername = params.username as string;
  const { platform, username } = parsePlatformUsername(rawUsername);
  const speeds = searchParams.get("speeds") || "";
  const since = searchParams.get("since") || "";
  const eco = searchParams.get("eco") || "";
  const gameCountParam = searchParams.get("gameCount") || "";
  const timeRangeLabelParam = searchParams.get("timeRangeLabel") || "";
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
  const [loadingStage, setLoadingStage] = useState<LoadingStage>("profile");

  useEffect(() => {
    const profileFromCache = !!cachedProfile;

    async function load() {
      try {
        // Fetch profile-basic (fast JSON response, ~50ms) instead of full NDJSON profile
        if (!profileFromCache) {
          setLoadingStage("profile");
          try {
            const platformQuery = platform === "chesscom" ? "?platform=chesscom" : "";
            const profileRes = await fetch(
              `/api/profile-basic/${encodeURIComponent(username)}${platformQuery}`
            );
            if (profileRes.ok) {
              const data = await profileRes.json();
              setProfile({
                username: data.username,
                fideEstimate: data.fideEstimate || { rating: 0 },
              });
              setProfileReady(true);
            } else {
              // PGN user: no online profile, use username as-is
              setProfile({ username, fideEstimate: { rating: 0 } });
              setProfileReady(true);
            }
          } catch {
            // Network error — still try to proceed for PGN users
            setProfile({ username, fideEstimate: { rating: 0 } });
            setProfileReady(true);
          }
        }

        // Fetch bot data (DB cache hit is instant, miss triggers full pipeline)
        setLoadingStage("fetching");
        let query = speeds ? `?speeds=${encodeURIComponent(speeds)}` : "";
        if (since) query += `${query ? "&" : "?"}since=${encodeURIComponent(since)}`;
        if (platform === "chesscom") query += `${query ? "&" : "?"}platform=chesscom`;
        if (platform === "fide") query += `${query ? "&" : "?"}platform=fide`;

        const botRes = await fetch(
          `/api/bot-data/${encodeURIComponent(username)}${query}`
        );

        if (botRes.ok) {
          setLoadingStage("building");
          const data: BotData = await botRes.json();
          setBotData(data);
        } else {
          // Fallback: build bot data client-side from PGN-imported games
          const pgnBotData = buildBotDataFromPGN(username);
          if (pgnBotData) setBotData(pgnBotData);
        }
        setLoadingStage("ready");
        setBotDataReady(true);
      } catch {
        setError("Failed to load game data.");
      }
    }

    load();
  }, [username, speeds, cachedProfile, platform, since]);

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
        opponentDisplayName: profile?.username || username,
        opponentFideEstimate: profile?.fideEstimate?.rating,
        scoutedUsername: username,
        scoutedPlatform: platform,
        ...(precomputedAnalysis ? {
          precomputedMoves: precomputedAnalysis.moves,
          precomputedSummary: precomputedAnalysis.summary,
        } : {}),
      })
    );

    router.push(`/analysis/${gameId}`);
  }, [playerColor, username, profile, platform, router]);

  // Use enhanced profile if available, otherwise fall back to bot-data profile
  const activeErrorProfile = enhancedErrorProfile || botData?.errorProfile || null;

  // Style metrics from server-side computation
  const styleMetrics = botData?.styleMetrics ?? null;

  // Bot data label for display
  const platformLabel = platform === "chesscom" ? "Chess.com" : platform === "fide" ? "FIDE OTB" : "Lichess";
  const gameCountStr = gameCountParam ? ` ${gameCountParam}` : "";
  const timeRangeStr = timeRangeLabelParam && timeRangeLabelParam !== "All time" ? ` in ${timeRangeLabelParam.toLowerCase()}` : "";
  const botDataLabel = enhancedErrorProfile
    ? `Bot enhanced with Stockfish analysis`
    : `Opening book from${gameCountStr} ${platformLabel} games${timeRangeStr}`;

  // Only block on profile — show color selection ASAP
  if (!profileReady && !error) {
    const stage = STAGE_LABELS[loadingStage];
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <div className="h-10 w-10 mx-auto rounded-full border-2 border-green-500 border-t-transparent animate-spin mb-4" />
          <p className="text-sm text-zinc-300 font-medium">{stage.title}</p>
          <p className="text-xs text-zinc-500 mt-1">{stage.detail}</p>
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
          {!!profile?.fideEstimate?.rating && (
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
    const stage = STAGE_LABELS[loadingStage];
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6 max-w-sm w-full">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-full border-2 border-green-500 border-t-transparent animate-spin flex-shrink-0" />
            <div>
              <p className="text-sm text-zinc-300 font-medium">
                {loadingOpening ? "Loading opening position..." : stage.title}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {loadingOpening
                  ? `Preparing ${openingName || eco}`
                  : stage.detail}
              </p>
            </div>
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
            onClick={() => {
              router.push(buildScoutUrl(platform, username));
            }}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            &larr; Back to player
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
          fideEstimate={profile?.fideEstimate?.rating || 1500}
          errorProfile={activeErrorProfile}
          whiteTrie={botData?.whiteTrie || null}
          blackTrie={botData?.blackTrie || null}
          onGameEnd={handleGameEnd}
          startingMoves={startingMoves || undefined}
          botDataLabel={botDataLabel}
          styleMetrics={styleMetrics}
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
        const isWhite = matchesPlayerName(g.white, username);
        const isBlack = matchesPlayerName(g.black, username);
        const playerIsWhite = isWhite && !isBlack ? true
          : isBlack && !isWhite ? false
          : isWhite;
        return {
          moves: g.moves,
          playerColor: (playerIsWhite ? "white" : "black") as "white" | "black",
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

    const styleMetrics: StyleMetrics = {
      aggression: 50,
      tactical: 50,
      positional: 50,
      endgame: 50,
      sampleSize: 0,
    };

    return { errorProfile, whiteTrie, blackTrie, styleMetrics };
  } catch {
    return null;
  }
}

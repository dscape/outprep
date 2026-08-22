"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { v4 as uuidv4 } from "uuid";
import { MoveEval, AnalysisSummary } from "@/lib/types";
import type { ErrorProfile, OpeningTrie } from "@outprep/engine";
import { getOpeningMoves } from "@/lib/analysis/eco-lookup";
import { parsePlatformUsername, buildScoutUrl } from "@/lib/platform-utils";
import { buildBotDataFromPGN, type BotData } from "@/lib/build-bot-data-from-pgn";
import { resolveMaiaRating } from "@/lib/fide-estimator";

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

/** Minimal profile info needed for the play page */
interface PlayProfile {
  username: string;
  fideEstimate: { rating: number; confidence?: number };
  ratings?: { blitz?: number };
  maiaRating?: number;
}

type LoadingStage = "profile" | "fetching" | "analyzing" | "building" | "ready";
type BotDataState = "loading" | "ready" | "error";

function hasBookPositions(trie: OpeningTrie | null | undefined): boolean {
  return !!trie && Object.keys(trie).length > 0;
}

function isBotData(value: unknown): value is BotData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<BotData>;
  return (
    !!data.whiteTrie &&
    typeof data.whiteTrie === "object" &&
    !!data.blackTrie &&
    typeof data.blackTrie === "object" &&
    !!data.errorProfile &&
    !!data.styleMetrics &&
    (hasBookPositions(data.whiteTrie) || hasBookPositions(data.blackTrie))
  );
}

const botDataRequests = new Map<string, Promise<unknown>>();
const BOT_DATA_REQUEST_TIMEOUT_MS = 40_000;
const PRACTICE_LOAD_TIMEOUT_MS = 45_000;

async function requestBotData(url: string): Promise<unknown> {
  const existing = botDataRequests.get(url);
  if (existing) return existing;

  const request = (async () => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, BOT_DATA_REQUEST_TIMEOUT_MS);

    try {
      let response = await fetch(url, { signal: controller.signal });
      if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get("Retry-After") || 1);
        const delay = Math.min(Math.max(retryAfterSeconds * 1000, 500), 5000);
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        response = await fetch(url, { signal: controller.signal });
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Repertoire request failed (${response.status}).`);
      }
      return response.json();
    } catch (error) {
      if (timedOut) {
        throw new Error("Loading game history timed out after 40 seconds. Please retry.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  })();

  botDataRequests.set(url, request);
  void request.finally(() => {
    if (botDataRequests.get(url) === request) botDataRequests.delete(url);
  }).catch(() => {});
  return request;
}

function getStageLabels(
  platform: string,
  expectedGameCount?: number,
): Record<LoadingStage, { title: string; detail: string }> {
  const expected = expectedGameCount
    ? `about ${expectedGameCount.toLocaleString("en-US")}`
    : "up to 2,000";
  const platformDetail =
    platform === "chesscom" ? `Fetching and processing ${expected} Chess.com games`
    : platform === "fide" ? expectedGameCount
      ? `Loading and processing about ${expectedGameCount.toLocaleString("en-US")} tournament games`
      : "Loading and processing tournament games from the database"
    : platform === "pgn" ? "Reading and processing the uploaded games"
    : `Fetching and processing ${expected} Lichess games`;

  return {
    profile: { title: "Loading player data...", detail: "Fetching ratings and profile" },
    fetching: { title: "Loading game history...", detail: platformDetail },
    analyzing: { title: "Analyzing games...", detail: "Computing error profile and play style" },
    building: { title: "Validating opening repertoire...", detail: "Checking the personalized opening book" },
    ready: { title: "Ready", detail: "" },
  };
}

function PracticeLoadingProgress({
  stage,
  labels,
}: {
  stage: LoadingStage;
  labels: Record<LoadingStage, { title: string; detail: string }>;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(
      () => setElapsedSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const activeStep = stage === "profile" ? 0 : stage === "fetching" ? 1 : 2;
  const current = labels[stage];

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="h-10 w-10 mx-auto rounded-full border-2 border-green-500 border-t-transparent animate-spin mb-4" />
        <div aria-live="polite">
          <p className="text-sm text-zinc-300 font-medium">{current.title}</p>
          <p className="text-xs text-zinc-500 mt-1 text-pretty">{current.detail}</p>
        </div>

        <div
          className="mt-5 grid grid-cols-3 gap-1.5"
          role="progressbar"
          aria-label="Practice loading progress"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={activeStep + 1}
          aria-valuetext={`Step ${activeStep + 1} of 3`}
        >
          {[0, 1, 2].map((step) => (
            <span
              key={step}
              className={`h-1 rounded-full ${
                step < activeStep
                  ? "bg-green-500"
                  : step === activeStep
                    ? "bg-green-500/70 animate-pulse"
                    : "bg-zinc-800"
              }`}
            />
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-600 tabular-nums">
          <span>Step {activeStep + 1} of 3</span>
          <span>{elapsedSeconds}s elapsed</span>
        </div>

        <p className="mt-4 min-h-5 text-xs text-zinc-500 text-pretty">
          {elapsedSeconds >= 25
            ? "This is taking longer than usual. The request will stop automatically rather than hang."
            : elapsedSeconds >= 10
              ? "Still working — large histories can take longer on their first load."
              : "This page updates as each step finishes."}
        </p>
      </div>
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="h-10 w-10 mx-auto rounded-full border-2 border-green-500 border-t-transparent animate-spin mb-3" />
            <p className="text-sm text-zinc-400">Loading game...</p>
          </div>
        </div>
      }
    >
      <PlayPageInner />
    </Suspense>
  );
}

function PlayPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawUsername = params.username as string;
  const { platform, username } = parsePlatformUsername(rawUsername);
  const speeds = searchParams.get("speeds") || "";
  const since = searchParams.get("since") || "";
  const eco = searchParams.get("eco") || "";
  const gameCountParam = searchParams.get("gameCount") || "";
  const parsedGameCount = Number(gameCountParam);
  const expectedGameCount = Number.isFinite(parsedGameCount) && parsedGameCount > 0
    ? Math.round(parsedGameCount)
    : undefined;
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
  const [botDataState, setBotDataState] = useState<BotDataState>("loading");
  const [botDataError, setBotDataError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
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
  const STAGE_LABELS = useMemo(
    () => getStageLabels(platform, expectedGameCount),
    [platform, expectedGameCount],
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let loadTimedOut = false;
    const profileFromCache = !!cachedProfile;
    const loadTimeout = window.setTimeout(() => {
      loadTimedOut = true;
      controller.abort();
      setBotData(null);
      setBotDataError(
        `Preparing personalized practice timed out after ${PRACTICE_LOAD_TIMEOUT_MS / 1000} seconds. Please retry.`,
      );
      setProfileReady(true);
      setBotDataState("error");
    }, PRACTICE_LOAD_TIMEOUT_MS);

    async function load() {
      setBotData(null);
      setBotDataError("");
      setBotDataState("loading");

      try {
        // Fetch the small profile response independently from the repertoire.
        if (!profileFromCache) {
          setLoadingStage("profile");
          try {
            const platformQuery = platform === "chesscom" ? "?platform=chesscom" : "";
            const profileRes = await fetch(
              `/api/profile-basic/${encodeURIComponent(username)}${platformQuery}`,
              { signal: controller.signal },
            );
            if (profileRes.ok) {
              const data = await profileRes.json();
              const fideEstimate = data.fideEstimate || { rating: 0 };
              setProfile({
                username: data.username,
                fideEstimate,
                ratings: data.ratings,
                maiaRating: resolveMaiaRating({
                  platform,
                  blitzRating: data.ratings?.blitz,
                  fideEstimate: fideEstimate.rating,
                }),
              });
            } else {
              setProfile({
                username,
                fideEstimate: { rating: 0 },
                maiaRating: resolveMaiaRating({ platform }),
              });
            }
            setProfileReady(true);
          } catch (profileError) {
            if (profileError instanceof DOMException && profileError.name === "AbortError") return;
            setProfile({
              username,
              fideEstimate: { rating: 0 },
              maiaRating: resolveMaiaRating({ platform }),
            });
            setProfileReady(true);
          }
        }

        if (platform === "pgn") {
          setLoadingStage("building");
          const pgnBotData = buildBotDataFromPGN(username);
          if (!pgnBotData || !isBotData(pgnBotData)) {
            throw new Error("No usable games were found in this PGN repertoire.");
          }
          setBotData(pgnBotData);
          setLoadingStage("ready");
          setBotDataState("ready");
          return;
        }

        setLoadingStage("fetching");
        const query = new URLSearchParams({ purpose: "play" });
        if (speeds) query.set("speeds", speeds);
        if (since) query.set("since", since);
        if (platform === "chesscom" || platform === "fide") {
          query.set("platform", platform);
        }

        const data = await requestBotData(
          `/api/bot-data/${encodeURIComponent(username)}?${query}`,
        );
        if (cancelled || loadTimedOut) return;

        setLoadingStage("building");
        if (!isBotData(data)) {
          throw new Error("No validated personalized opening repertoire is available for these filters.");
        }
        setBotData(data);
        setLoadingStage("ready");
        setBotDataState("ready");
      } catch (loadError) {
        if (
          cancelled ||
          loadTimedOut ||
          (loadError instanceof DOMException && loadError.name === "AbortError")
        ) return;
        setBotData(null);
        setBotDataError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load the personalized opening repertoire.",
        );
        setBotDataState("error");
      } finally {
        window.clearTimeout(loadTimeout);
      }
    }

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(loadTimeout);
      controller.abort();
    };
  }, [username, speeds, cachedProfile, platform, since, loadAttempt]);

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

  const platformLabel = platform === "chesscom"
    ? "Chess.com"
    : platform === "fide"
      ? "FIDE OTB"
      : platform === "pgn"
        ? "uploaded PGN"
        : "Lichess";
  const displayedGameCount = botData?.gameCount ?? (gameCountParam ? Number(gameCountParam) : undefined);
  const gameCountStr = displayedGameCount ? ` ${displayedGameCount}` : "";
  const timeRangeStr = !botData?.degraded && timeRangeLabelParam && timeRangeLabelParam !== "All time"
    ? ` in ${timeRangeLabelParam.toLowerCase()}`
    : "";
  const fallbackLabel = botData?.degraded ? " (all-time cached fallback)" : "";
  const botDataLabel = enhancedErrorProfile
    ? "Bot enhanced with Stockfish analysis"
    : `Opening book from${gameCountStr} ${platformLabel} games${timeRangeStr}${fallbackLabel}`;

  if (!profileReady || botDataState === "loading") {
    return (
      <PracticeLoadingProgress
        key={`${username}:${speeds}:${since}:${loadAttempt}`}
        stage={loadingStage}
        labels={STAGE_LABELS}
      />
    );
  }

  if (botDataState === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h2 className="text-xl font-bold text-white mb-2">Personalized practice unavailable</h2>
          <p className="text-zinc-400 mb-2">{botDataError}</p>
          <p className="text-xs text-zinc-600 mb-5">
            The board is disabled rather than substituting a generic engine opponent.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
            >
              Retry
            </button>
            <button
              onClick={() => router.push(buildScoutUrl(platform, username))}
              className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700"
            >
              Back to player
            </button>
          </div>
        </div>
      </div>
    );
  }

  const canPlayWhite = hasBookPositions(botData?.blackTrie);
  const canPlayBlack = hasBookPositions(botData?.whiteTrie);

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
              disabled={!canPlayWhite}
              className="group relative rounded-xl border border-zinc-700 bg-zinc-800/50 p-6 transition-all enabled:hover:border-green-500 enabled:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <div className="text-5xl mb-2">&#9818;</div>
              <span className="text-sm font-medium text-zinc-300 group-enabled:group-hover:text-white">
                White
              </span>
              {!canPlayWhite && <span className="block text-[10px] text-zinc-500 mt-2">No black repertoire</span>}
            </button>
            <button
              onClick={() => setPlayerColor("black")}
              disabled={!canPlayBlack}
              className="group relative rounded-xl border border-zinc-700 bg-zinc-800/50 p-6 transition-all enabled:hover:border-green-500 enabled:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <div className="text-5xl mb-2">&#9812;</div>
              <span className="text-sm font-medium text-zinc-300 group-enabled:group-hover:text-white">
                Black
              </span>
              {!canPlayBlack && <span className="block text-[10px] text-zinc-500 mt-2">No white repertoire</span>}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (
    (playerColor === "white" && !canPlayWhite) ||
    (playerColor === "black" && !canPlayBlack)
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h2 className="text-xl font-bold text-white mb-2">No repertoire for this color</h2>
          <p className="text-zinc-400 mb-5">
            There are not enough games for {profile?.username} as the opposing color.
          </p>
          <button
            onClick={() => setPlayerColor(null)}
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700"
          >
            Choose another color
          </button>
        </div>
      </div>
    );
  }

  if (loadingOpening) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6 max-w-sm w-full">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-full border-2 border-green-500 border-t-transparent animate-spin flex-shrink-0" />
            <div>
              <p className="text-sm text-zinc-300 font-medium">Loading opening position...</p>
              <p className="text-xs text-zinc-500 mt-0.5">Preparing {openingName || eco}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
          maiaRating={profile?.maiaRating ?? resolveMaiaRating({
            platform,
            blitzRating: profile?.ratings?.blitz,
            fideEstimate: profile?.fideEstimate?.rating,
          })}
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


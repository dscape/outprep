"use client";

import { ErrorProfile, PhaseErrors } from "@/lib/types";
import { EvalMode, estimateTime } from "@/lib/engine/batch-eval";

interface ErrorProfileCardProps {
  errorProfile: ErrorProfile;
  totalGames?: number;
  onUpgrade?: (mode: EvalMode) => void;
  upgradeProgress?: {
    gamesComplete: number;
    totalGames: number;
    pct: number;
  } | null;
  isUpgrading?: boolean;
  upgradeComplete?: boolean;
}

/**
 * Each bar is scaled independently against a fixed reference rate (20%).
 * Within the colored portion, blunders and mistakes are stacked.
 */
function PhaseBar({
  label,
  phase,
}: {
  label: string;
  phase: PhaseErrors;
}) {
  const errorPct = (phase.errorRate * 100).toFixed(1);

  if (phase.totalMoves === 0) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-300 font-medium">{label}</span>
          <span className="text-zinc-600 text-xs">No data</span>
        </div>
        <div className="h-5 rounded-md bg-zinc-800/50" />
      </div>
    );
  }

  // Scale against a fixed reference rate: 20% error rate = full bar
  const REFERENCE_RATE = 0.20;
  const filledPct = Math.min((phase.errorRate / REFERENCE_RATE) * 100, 100);

  const totalErrors = phase.mistakes + phase.blunders;

  // Each segment's share of the colored portion
  const blunderShare =
    totalErrors > 0 ? (phase.blunders / totalErrors) * filledPct : 0;
  const mistakeShare =
    totalErrors > 0 ? (phase.mistakes / totalErrors) * filledPct : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-300 font-medium">{label}</span>
        <span className="text-zinc-500 tabular-nums text-xs">
          {errorPct}% error rate · {phase.avgCPL} CPL · {phase.totalMoves} moves
        </span>
      </div>
      <div className="flex h-5 overflow-hidden rounded-md bg-zinc-800/50">
        {/* Blunders (red) */}
        {blunderShare > 0 && (
          <div
            className="bg-red-500/80 flex items-center justify-center shrink-0"
            style={{ width: `${blunderShare}%`, minWidth: "3px" }}
          >
            {phase.blunders >= 2 && blunderShare > 6 && (
              <span className="text-[10px] text-white font-medium">
                {phase.blunders}
              </span>
            )}
          </div>
        )}
        {/* Mistakes (yellow) */}
        {mistakeShare > 0 && (
          <div
            className="bg-yellow-500/80 flex items-center justify-center shrink-0"
            style={{ width: `${mistakeShare}%`, minWidth: "3px" }}
          >
            {phase.mistakes >= 2 && mistakeShare > 6 && (
              <span className="text-[10px] text-zinc-900 font-medium">
                {phase.mistakes}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function generateInsight(profile: ErrorProfile): string | null {
  const phases = [
    { name: "opening", errors: profile.opening },
    { name: "middlegame", errors: profile.middlegame },
    { name: "endgame", errors: profile.endgame },
  ].filter((p) => p.errors.totalMoves >= 10);

  if (phases.length < 2) return null;

  phases.sort((a, b) => b.errors.errorRate - a.errors.errorRate);
  const weakest = phases[0];
  const strongest = phases[phases.length - 1];

  if (strongest.errors.errorRate === 0 || weakest.errors.errorRate === 0)
    return null;

  const ratio = weakest.errors.errorRate / strongest.errors.errorRate;

  if (ratio >= 2) {
    return `Makes ${ratio.toFixed(1)}x more mistakes in ${weakest.name}s than ${strongest.name}s.`;
  }

  if (weakest.errors.blunderRate > 0.05) {
    return `Blunders ${(weakest.errors.blunderRate * 100).toFixed(1)}% of moves in the ${weakest.name} — a significant tactical weakness.`;
  }

  return `Weakest phase: ${weakest.name} (${(weakest.errors.errorRate * 100).toFixed(1)}% error rate).`;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) return `~${mins} min`;
  return `~${mins}m ${secs}s`;
}

export default function ErrorProfileCard({
  errorProfile,
  totalGames,
  onUpgrade,
  upgradeProgress,
  isUpgrading = false,
  upgradeComplete = false,
}: ErrorProfileCardProps) {
  if (errorProfile.gamesAnalyzed === 0 && !isUpgrading) {
    return null;
  }

  const insight = generateInsight(errorProfile);

  const hasUnevaluatedGames =
    totalGames !== undefined && totalGames > errorProfile.gamesAnalyzed;
  const unevaluatedCount = hasUnevaluatedGames
    ? totalGames - errorProfile.gamesAnalyzed
    : 0;

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide">
          Error Profile
        </h3>
        <span className="text-xs text-zinc-600">
          {upgradeComplete && totalGames
            ? `${totalGames} games analyzed`
            : `${errorProfile.gamesAnalyzed} games with evals`}
        </span>
      </div>

      <div className="space-y-3">
        <PhaseBar
          label="Opening"
          phase={errorProfile.opening}
        />
        <PhaseBar
          label="Middlegame"
          phase={errorProfile.middlegame}
        />
        <PhaseBar
          label="Endgame"
          phase={errorProfile.endgame}
        />
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-3 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-red-500/80" />{" "}
          Blunders
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-yellow-500/80" />{" "}
          Mistakes
        </span>
      </div>

      {/* Insight line */}
      {insight && (
        <p className="mt-3 text-sm text-zinc-400 border-t border-zinc-700/50 pt-3">
          {insight}
        </p>
      )}

      {/* Overall stats */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-zinc-900/50 p-2">
          <div className="text-lg font-bold font-mono text-white">
            {errorProfile.overall.avgCPL}
          </div>
          <div className="text-[10px] text-zinc-500">Avg CPL</div>
        </div>
        <div className="rounded-lg bg-zinc-900/50 p-2">
          <div className="text-lg font-bold font-mono text-white">
            {(errorProfile.overall.errorRate * 100).toFixed(1)}%
          </div>
          <div className="text-[10px] text-zinc-500">Error Rate</div>
        </div>
        <div className="rounded-lg bg-zinc-900/50 p-2">
          <div className="text-lg font-bold font-mono text-white">
            {(errorProfile.overall.blunderRate * 100).toFixed(1)}%
          </div>
          <div className="text-[10px] text-zinc-500">Blunder Rate</div>
        </div>
      </div>

      {/* Upgrade section */}
      {hasUnevaluatedGames && !isUpgrading && !upgradeComplete && onUpgrade && (
        <div className="mt-4 border-t border-zinc-700/50 pt-4">
          <p className="text-xs text-zinc-500 mb-3">
            Based on {errorProfile.gamesAnalyzed} of {totalGames} games.
            Analyze the remaining {unevaluatedCount} for a more accurate
            profile.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onUpgrade("sampling")}
              className="flex-1 rounded-lg border border-zinc-600/40 bg-zinc-700/30 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/50 hover:border-zinc-500/50"
            >
              Quick scan{" "}
              <span className="text-zinc-500">
                {formatTime(estimateTime(unevaluatedCount, "sampling"))}
              </span>
            </button>
            <button
              onClick={() => onUpgrade("comprehensive")}
              className="flex-1 rounded-lg border border-zinc-600/40 bg-zinc-700/30 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/50 hover:border-zinc-500/50"
            >
              Deep analysis{" "}
              <span className="text-zinc-500">
                {formatTime(estimateTime(unevaluatedCount, "comprehensive"))}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Initializing state (before progress starts) */}
      {isUpgrading && !upgradeProgress && (
        <div className="mt-4 border-t border-zinc-700/50 pt-4">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <div className="h-3 w-3 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
            Initializing engine...
          </div>
        </div>
      )}

      {/* Progress bar */}
      {isUpgrading && upgradeProgress && (
        <div className="mt-4 border-t border-zinc-700/50 pt-4">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
            <span>
              Analyzing... {upgradeProgress.gamesComplete}/
              {upgradeProgress.totalGames} games
            </span>
            <span>{upgradeProgress.pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-700/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-500"
              style={{ width: `${upgradeProgress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Upgrade complete */}
      {upgradeComplete && totalGames && (
        <div className="mt-4 border-t border-zinc-700/50 pt-3">
          <p className="text-xs text-green-400 flex items-center gap-1.5">
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
            Full analysis — {totalGames} games
          </p>
        </div>
      )}
    </div>
  );
}

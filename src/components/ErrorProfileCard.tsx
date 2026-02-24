"use client";

import { ErrorProfile, PhaseErrors } from "@/lib/types";

interface ErrorProfileCardProps {
  errorProfile: ErrorProfile;
}

/**
 * Each bar always takes full width. The colored portion (errors) is scaled
 * relative to the worst phase so bars are visually comparable:
 *   - Worst phase → errors fill 100% of bar
 *   - Other phases → errors fill (their rate / worst rate) of bar
 *   - Remaining is gray (clean moves)
 *
 * Within the colored portion, blunders/mistakes/inaccuracies are stacked.
 */
function PhaseBar({
  label,
  phase,
  maxErrorRate,
}: {
  label: string;
  phase: PhaseErrors;
  maxErrorRate: number;
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

  // Total width of the colored portion (relative to worst phase)
  const filledPct = maxErrorRate > 0
    ? (phase.errorRate / maxErrorRate) * 100
    : 0;

  const totalErrors = phase.inaccuracies + phase.mistakes + phase.blunders;

  // Each segment's share of the colored portion
  const blunderShare = totalErrors > 0 ? (phase.blunders / totalErrors) * filledPct : 0;
  const mistakeShare = totalErrors > 0 ? (phase.mistakes / totalErrors) * filledPct : 0;
  const inaccuracyShare = totalErrors > 0 ? (phase.inaccuracies / totalErrors) * filledPct : 0;
  const cleanShare = 100 - filledPct;

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
              <span className="text-[10px] text-white font-medium">{phase.blunders}</span>
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
              <span className="text-[10px] text-zinc-900 font-medium">{phase.mistakes}</span>
            )}
          </div>
        )}
        {/* Inaccuracies (orange) */}
        {inaccuracyShare > 0 && (
          <div
            className="bg-orange-500/60 flex items-center justify-center shrink-0"
            style={{ width: `${inaccuracyShare}%`, minWidth: "3px" }}
          >
            {phase.inaccuracies >= 2 && inaccuracyShare > 6 && (
              <span className="text-[10px] text-white font-medium">{phase.inaccuracies}</span>
            )}
          </div>
        )}
        {/* Clean portion (gray) */}
        {cleanShare > 0 && (
          <div className="bg-green-500/10 flex-1" />
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

  if (strongest.errors.errorRate === 0 || weakest.errors.errorRate === 0) return null;

  const ratio = weakest.errors.errorRate / strongest.errors.errorRate;

  if (ratio >= 2) {
    return `Makes ${ratio.toFixed(1)}x more mistakes in ${weakest.name}s than ${strongest.name}s.`;
  }

  if (weakest.errors.blunderRate > 0.05) {
    return `Blunders ${(weakest.errors.blunderRate * 100).toFixed(1)}% of moves in the ${weakest.name} — a significant tactical weakness.`;
  }

  return `Weakest phase: ${weakest.name} (${(weakest.errors.errorRate * 100).toFixed(1)}% error rate).`;
}

export default function ErrorProfileCard({ errorProfile }: ErrorProfileCardProps) {
  if (errorProfile.gamesAnalyzed === 0) {
    return null;
  }

  const maxErrorRate = Math.max(
    errorProfile.opening.errorRate,
    errorProfile.middlegame.errorRate,
    errorProfile.endgame.errorRate,
    0.01
  );

  const insight = generateInsight(errorProfile);

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide">
          Error Profile
        </h3>
        <span className="text-xs text-zinc-600">
          {errorProfile.gamesAnalyzed} games with evals
        </span>
      </div>

      <div className="space-y-3">
        <PhaseBar label="Opening" phase={errorProfile.opening} maxErrorRate={maxErrorRate} />
        <PhaseBar label="Middlegame" phase={errorProfile.middlegame} maxErrorRate={maxErrorRate} />
        <PhaseBar label="Endgame" phase={errorProfile.endgame} maxErrorRate={maxErrorRate} />
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-3 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-red-500/80" /> Blunders
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-yellow-500/80" /> Mistakes
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-orange-500/60" /> Inaccuracies
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
    </div>
  );
}

/**
 * Leaderboard recording — records session results and prints standings.
 *
 * Extracted from agent-manager.ts. Only agent-manager should call these
 * functions (anti-cheating: agents cannot write to the leaderboard directly).
 */

import {
  recordSessionResult,
  getLeaderboard,
} from "../state/leaderboard-db";
import type { ForgeSession } from "../state/types";

export function recordSessionToLeaderboard(
  agentId: string,
  agentName: string,
  session: ForgeSession,
  startedAt: string,
): void {
  const endedAt = new Date().toISOString();
  const durationMs =
    new Date(endedAt).getTime() - new Date(startedAt).getTime();

  // Compute deltas vs baseline
  const baselineComposite =
    session.baseline?.aggregate?.compositeScore ?? 0;
  const bestComposite = session.bestResult?.compositeScore ?? 0;
  const compositeDelta = bestComposite - baselineComposite;

  const baselineAccuracy =
    session.baseline?.aggregate?.moveAccuracy ?? 0;
  const bestAccuracy = session.bestResult?.moveAccuracy ?? 0;
  const accuracyDelta = bestAccuracy - baselineAccuracy;

  const baselineCplKl =
    session.baseline?.aggregate?.cplKLDivergence ?? 0;
  const bestCplKl =
    session.bestResult?.cplKLDivergence ?? baselineCplKl;
  // Negate so positive = improvement (lower KL is better)
  const cplKlDelta = -(bestCplKl - baselineCplKl);

  // Check if session was exploratory (groundbreaking hypothesis)
  const hypothesisSets = session.hypothesisSets ?? [];
  const latestHypothesis =
    hypothesisSets.length > 0
      ? hypothesisSets[hypothesisSets.length - 1]
      : null;
  const isExploratory =
    latestHypothesis?.committedLevel === "groundbreaking";

  // Check if session had any code changes (config-only sessions get penalized)
  const hasCodeChanges = session.experiments.some(
    (e) => (e.codeChanges?.length ?? 0) > 0
  ) || (session.activeChanges?.length ?? 0) > 0;
  const isConfigOnly = !hasCodeChanges;

  recordSessionResult({
    id: `${agentId}:${session.id}`,
    agentId,
    agentName,
    sessionId: session.id,
    sessionName: session.name,
    startedAt,
    endedAt,
    durationSeconds: Math.round(durationMs / 1000),
    experimentsCount: session.experiments.length,
    accuracyDelta,
    cplKlDelta,
    compositeDelta,
    isExploratory,
    isConfigOnly,
    totalCostUsd: session.totalCostUsd,
  });
}

export function printLeaderboard(currentAgentId: string): void {
  const leaderboard = getLeaderboard();
  if (leaderboard.length === 0) return;

  console.log(`\n  Leaderboard:`);
  for (const entry of leaderboard) {
    const marker = entry.agentId === currentAgentId ? " ← YOU" : "";
    const sign = entry.avgWeightedCompositeDelta > 0 ? "+" : "";
    console.log(
      `  #${entry.rank} ${entry.agentName.padEnd(15)} ` +
        `avg Δ: ${sign}${entry.avgWeightedCompositeDelta.toFixed(4)}  ` +
        `sessions: ${entry.sessionsCount}${marker}`,
    );
  }
}

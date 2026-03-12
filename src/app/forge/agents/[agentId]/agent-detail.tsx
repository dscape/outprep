"use client";

import { useState } from "react";
import Link from "next/link";
import type { AgentDetail, AgentSessionEntry } from "@/lib/forge-types";
import { AgentStatusBadge } from "@/components/forge/AgentStatusBadge";
import { StopAgentButton } from "./stop-agent-button";
import { StartAgentButton } from "./start-agent-button";
import { NewAgentDialog } from "../new-agent-dialog";

function biasLabel(bias: number): { text: string; color: string } {
  if (bias >= 0.75) return { text: "Aggressive", color: "text-red-400" };
  if (bias >= 0.4) return { text: "Balanced", color: "text-amber-400" };
  return { text: "Conservative", color: "text-blue-400" };
}

export function AgentDetailView({ agent }: { agent: AgentDetail }) {
  const sign = agent.avgWeightedCompositeDelta > 0 ? "+" : "";
  const hours = Math.round(agent.totalTimeSeconds / 3600);
  const reversedHistory = [...agent.sessionHistory].reverse();
  const bias = biasLabel(agent.config.researchBias ?? 0.5);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {agent.rank !== null && (
            <span className="flex items-center justify-center h-10 w-10 rounded-full bg-zinc-800 text-base font-bold text-zinc-300 border border-zinc-700">
              #{agent.rank}
            </span>
          )}
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-zinc-100">{agent.name}</h2>
              <AgentStatusBadge status={agent.runStatus} detail={agent.runStatusDetail} />
            </div>
            <p className="text-sm text-zinc-500 mt-0.5">
              {agent.config.players?.length
                ? <>{agent.config.players.join(", ")} &middot; {agent.config.focus ?? "accuracy"}</>
                : <span className="text-purple-400">Autonomous</span>}
              {" "}&middot;{" "}
              <span className={bias.color}>{bias.text}</span>
              {" "}&middot; Created {new Date(agent.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>
        <AgentActions agentId={agent.id} isRunning={agent.isRunning} />
      </div>

      {/* Metrics */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 text-sm">
          <div>
            <p className="text-zinc-500 text-xs">Avg &Delta;</p>
            <p className={`font-mono ${
              agent.avgWeightedCompositeDelta > 0 ? "text-emerald-400" : agent.avgWeightedCompositeDelta < 0 ? "text-red-400" : "text-zinc-400"
            }`}>
              {sign}{agent.avgWeightedCompositeDelta.toFixed(4)}
            </p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Accuracy &Delta;</p>
            <p className={`font-mono ${
              agent.avgAccuracyDelta > 0 ? "text-emerald-400" : agent.avgAccuracyDelta < 0 ? "text-red-400" : "text-zinc-400"
            }`}>
              {agent.avgAccuracyDelta > 0 ? "+" : ""}{(agent.avgAccuracyDelta * 100).toFixed(2)}%
            </p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Sessions</p>
            <p className="font-mono text-zinc-300">{agent.sessionCount}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Time</p>
            <p className="font-mono text-zinc-300">{hours}h</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Cost</p>
            <p className="font-mono text-zinc-300">${agent.totalCostUsd.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Tokens</p>
            <p className="font-mono text-zinc-300 text-xs">
              {formatTokens(agent.totalInputTokens)}in / {formatTokens(agent.totalOutputTokens)}out
            </p>
          </div>
        </div>
      </div>

      {/* Current Session */}
      {agent.currentSessionId && agent.currentSessionName && (
        <Link
          href={`/forge/${agent.currentSessionId}`}
          className="block rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-4 hover:bg-emerald-900/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            {agent.isRunning && (
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
            <p className="text-sm font-medium text-emerald-400">Current Session</p>
          </div>
          <p className="text-sm text-zinc-300 mt-1">{agent.currentSessionName}</p>
        </Link>
      )}

      {/* Decision History */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-100 mb-3">
          Session History ({agent.sessionHistory.length})
        </h3>
        {reversedHistory.length > 0 ? (
          <div className="space-y-3">
            {reversedHistory.map((entry, i) => (
              <SessionHistoryEntry key={`${entry.sessionId}-${i}`} entry={entry} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
            <p className="text-sm text-zinc-500">No sessions yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentActions({ agentId, isRunning }: { agentId: string; isRunning: boolean }) {
  const [showNewAgent, setShowNewAgent] = useState(false);

  return (
    <div className="flex gap-2">
      {isRunning
        ? <StopAgentButton agentId={agentId} />
        : <StartAgentButton agentId={agentId} />
      }
      <button
        onClick={() => setShowNewAgent(true)}
        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-emerald-400 hover:bg-zinc-700 transition-colors"
      >
        + New Agent
      </button>
      {showNewAgent && <NewAgentDialog onClose={() => setShowNewAgent(false)} />}
    </div>
  );
}

function SessionHistoryEntry({ entry }: { entry: AgentSessionEntry }) {
  const startDate = new Date(entry.startedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const endDate = entry.endedAt
    ? new Date(entry.endedAt).toLocaleDateString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <Link
            href={`/forge/${entry.sessionId}`}
            className="text-sm font-medium text-zinc-200 hover:text-emerald-400 transition-colors"
          >
            {entry.sessionName}
          </Link>
          <p className="text-xs text-zinc-500 mt-0.5">
            {startDate}
            {endDate && <> &rarr; {endDate}</>}
            {!endDate && <span className="text-emerald-400 ml-2">In progress</span>}
          </p>
        </div>
        {entry.endReason && <EndReasonBadge reason={entry.endReason} />}
      </div>

      {entry.decision && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <ActionBadge action={entry.decision.action} />
            {entry.decision.players.length > 0 && (
              <span className="text-xs text-zinc-500">
                {entry.decision.players.join(", ")}
              </span>
            )}
            {entry.decision.focus && (
              <span className="text-xs text-zinc-500">
                &middot; {entry.decision.focus}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap bg-zinc-950 rounded px-3 py-2 max-h-40 overflow-y-auto">
            {entry.decision.reasoning}
          </p>
          {entry.decision.resumeSessionId && (
            <p className="text-xs text-zinc-500 mt-1">
              Resumed:{" "}
              <Link
                href={`/forge/${entry.decision.resumeSessionId}`}
                className="text-zinc-400 hover:text-emerald-400"
              >
                {entry.decision.resumeSessionId.slice(0, 8)}...
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, string> = {
    start_new: "border-blue-700 text-blue-400",
    resume_session: "border-amber-700 text-amber-400",
    join_session: "border-purple-700 text-purple-400",
    wait: "border-zinc-700 text-zinc-400",
  };
  const labels: Record<string, string> = {
    start_new: "New Session",
    resume_session: "Resumed",
    join_session: "Joined",
    wait: "Wait",
  };

  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${styles[action] ?? "border-zinc-700 text-zinc-400"}`}>
      {labels[action] ?? action}
    </span>
  );
}

function EndReasonBadge({ reason }: { reason: string }) {
  const styles: Record<string, string> = {
    completed: "bg-emerald-900/50 text-emerald-400 border-emerald-800/50",
    abandoned: "bg-amber-900/50 text-amber-400 border-amber-800/50",
    stopped: "bg-red-900/50 text-red-400 border-red-800/50",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${styles[reason] ?? "bg-zinc-800 text-zinc-400 border-zinc-700"}`}>
      {reason}
    </span>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M `;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K `;
  return `${n} `;
}

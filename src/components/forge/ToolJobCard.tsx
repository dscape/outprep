"use client";

import { useState } from "react";
import type { ToolJob } from "@/lib/forge-types";

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-900/40 text-amber-400">
          pending
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-900/40 text-emerald-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          running
        </span>
      );
    case "completed":
      return (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-900/40 text-emerald-400">
          completed
        </span>
      );
    case "failed":
      return (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-900/40 text-red-400">
          failed
        </span>
      );
    case "archived":
      return (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-800 text-zinc-500">
          archived
        </span>
      );
    default:
      return (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-800 text-zinc-400">
          {status}
        </span>
      );
  }
}

const TOOL_LABELS: Record<string, string> = {
  eval_player: "Eval",
  oracle: "Oracle",
  web_search: "Search",
  web_fetch: "Fetch",
  code_prompt: "Code",
};

function formatDuration(startedAt: string, completedAt: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatWaiting(createdAt: string): string {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  const seconds = Math.round(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function extractTarget(input: string | null): string | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    return parsed.username || parsed.player || parsed.target
      || parsed.query || parsed.url
      || (parsed.question ? parsed.question.slice(0, 60) + (parsed.question.length > 60 ? "..." : "") : null)
      || (parsed.instruction ? parsed.instruction.slice(0, 60) + (parsed.instruction.length > 60 ? "..." : "") : null)
      || null;
  } catch {
    return null;
  }
}

/** Stale = pending for more than 5 minutes */
function isStale(job: ToolJob): boolean {
  if (job.status !== "pending") return false;
  return Date.now() - new Date(job.created_at).getTime() > 5 * 60 * 1000;
}

export function ToolJobCard({ job, compact }: { job: ToolJob; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(job.created_at).toLocaleString();
  const isArchived = job.status === "archived";
  const isBlocking =
    job.blocking === 1 && !["completed", "failed", "archived"].includes(job.status);
  const parsedInput = job.input ? (() => { try { return JSON.parse(job.input!); } catch { return job.input; } })() : null;
  const parsedOutput = job.output ? (() => { try { return JSON.parse(job.output!); } catch { return job.output; } })() : null;
  const parsedProgress = job.progress ? (() => { try { return JSON.parse(job.progress!) as { gamesProcessed: number; totalGames: number; positionsEvaluated: number; currentGameId?: string; updatedAt?: string }; } catch { return null; } })() : null;
  const target = extractTarget(job.input);
  const stale = isStale(job);
  const isPending = job.status === "pending" || job.status === "running";
  const toolLabel = TOOL_LABELS[job.tool_name] ?? job.tool_name;
  const retryCount = job.retry_count ?? 0;

  if (compact) {
    return (
      <div className={`flex items-center gap-2 py-1.5 px-3 rounded text-xs ${
        isArchived ? "bg-zinc-800/20 opacity-60" : stale ? "bg-red-900/10" : "bg-zinc-800/30"
      }`}>
        <span className="text-zinc-400 font-mono w-16 shrink-0">{toolLabel}</span>
        {target && <span className={`font-medium ${isArchived ? "text-zinc-400" : "text-zinc-200"}`}>{target}</span>}
        <StatusBadge status={job.status} />
        {retryCount > 0 && (
          <span className="text-amber-500 text-[10px]">retry {retryCount}</span>
        )}
        {stale && (
          <span className="text-red-400 text-[10px]">
            stale ({formatWaiting(job.created_at)})
          </span>
        )}
        {isPending && !stale && (
          <span className="text-zinc-600 text-[10px]">
            {formatWaiting(job.created_at)}
          </span>
        )}
        {job.started_at && job.completed_at && (
          <span className="text-zinc-600 text-[10px]">
            {formatDuration(job.started_at, job.completed_at)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border bg-zinc-900 p-4 ${
        isArchived
          ? "border-zinc-800/60 opacity-60"
          : stale
            ? "border-red-800/60 border-l-2 border-l-red-500"
            : isBlocking
              ? "border-zinc-800 border-l-2 border-l-amber-500"
              : "border-zinc-800"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-sm font-medium ${isArchived ? "text-zinc-400" : "text-zinc-100"}`}>
              {toolLabel}
            </span>
            {target && (
              <span className={`text-sm ${isArchived ? "text-zinc-500" : "text-zinc-300"}`}>
                &rarr; {target}
              </span>
            )}
            <StatusBadge status={job.status} />
            {isBlocking && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-900/30 text-amber-500 border border-amber-800/50">
                blocking
              </span>
            )}
            {stale && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-900/30 text-red-400 border border-red-800/50">
                stale
              </span>
            )}
            {retryCount > 0 && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-900/30 text-amber-500 border border-amber-800/50">
                retry {retryCount}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            {job.agent_name ? `Agent: ${job.agent_name}` : job.agent_id ? `Agent: ${job.agent_id.slice(0, 8)}` : "No agent"}
            {" · "}Session: {job.session_id.slice(0, 8)}
            {" · "}{time}
            {isPending && (
              <span className={stale ? " text-red-400" : ""}>
                {" · "}waiting {formatWaiting(job.created_at)}
              </span>
            )}
            {job.status === "running" && parsedProgress && (
              <span className="text-emerald-400">
                {" · "}{parsedProgress.gamesProcessed}/{parsedProgress.totalGames} games
              </span>
            )}
            {job.started_at && job.completed_at && (
              <> · {formatDuration(job.started_at, job.completed_at)}</>
            )}
          </p>
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 rounded px-2 py-1 text-[10px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
        >
          {expanded ? "Hide" : "Details"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          {parsedInput && (
            <div>
              <p className="text-[10px] font-medium text-zinc-500 mb-1">Input</p>
              <pre className="text-xs text-zinc-400 bg-zinc-800/50 rounded p-2 overflow-x-auto">
                {typeof parsedInput === "string" ? parsedInput : JSON.stringify(parsedInput, null, 2)}
              </pre>
            </div>
          )}
          {parsedProgress && (job.status === "running" || job.status === "pending") && (
            <div>
              <p className="text-[10px] font-medium text-zinc-500 mb-1">Progress</p>
              <div className="bg-zinc-800/50 rounded p-2">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>{parsedProgress.gamesProcessed}/{parsedProgress.totalGames} games</span>
                  <span>{parsedProgress.positionsEvaluated} positions</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-700">
                  <div
                    className="h-full bg-emerald-500 transition-[width] duration-500"
                    style={{ width: `${parsedProgress.totalGames > 0 ? Math.round((parsedProgress.gamesProcessed / parsedProgress.totalGames) * 100) : 0}%` }}
                  />
                </div>
                {parsedProgress.updatedAt && (
                  <p className="text-[10px] text-zinc-600 mt-1">
                    Last update: {formatWaiting(parsedProgress.updatedAt)} ago
                  </p>
                )}
              </div>
            </div>
          )}
          {stale && !parsedProgress && (
            <div>
              <p className="text-[10px] font-medium text-red-400 mb-1">Diagnostic</p>
              <p className="text-xs text-red-300/70 bg-red-900/20 rounded p-2">
                {job.status === "pending"
                  ? `Queued for ${formatWaiting(job.created_at)} — the eval service has not picked up this job yet. Check the service status above.`
                  : `Running for ${formatWaiting(job.started_at ?? job.created_at)} with no progress updates. The eval service may be stuck.`}
              </p>
            </div>
          )}
          {job.status === "completed" && parsedOutput && (
            <div>
              <p className="text-[10px] font-medium text-zinc-500 mb-1">Output</p>
              <pre className="text-xs text-zinc-400 bg-zinc-800/50 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
                {typeof parsedOutput === "string" ? parsedOutput : JSON.stringify(parsedOutput, null, 2)}
              </pre>
            </div>
          )}
          {job.status === "failed" && job.error && (
            <div>
              <p className="text-[10px] font-medium text-red-400 mb-1">Error</p>
              <pre className="text-xs text-red-300 bg-red-900/20 rounded p-2 overflow-x-auto">
                {job.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

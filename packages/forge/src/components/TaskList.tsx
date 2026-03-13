"use client";

import { useEffect, useState, useCallback } from "react";
import { ToolJobCard } from "./ToolJobCard";
import { PermissionRequestCard } from "./PermissionRequestCard";
import type { TasksResponse, ToolJob } from "@/lib/forge-types";

type StatusFilter = "active" | "archived" | "all";
type TypeFilter = "all" | "eval_player" | "oracle" | "web_search" | "web_fetch" | "code_prompt" | "permission";

const POLL_INTERVAL = 5000;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

interface AgentGroup {
  agentName: string;
  agentId: string | null;
  jobs: ToolJob[];
  staleCount: number;
}

function groupByAgent(jobs: ToolJob[]): AgentGroup[] {
  const map = new Map<string, AgentGroup>();
  for (const job of jobs) {
    const key = job.agent_name ?? job.agent_id ?? "unknown";
    if (!map.has(key)) {
      map.set(key, {
        agentName: job.agent_name ?? job.agent_id?.slice(0, 8) ?? "Unknown",
        agentId: job.agent_id,
        jobs: [],
        staleCount: 0,
      });
    }
    const group = map.get(key)!;
    group.jobs.push(job);
    if (
      job.status === "pending" &&
      Date.now() - new Date(job.created_at).getTime() > STALE_THRESHOLD_MS
    ) {
      group.staleCount++;
    }
  }
  // Sort: groups with stale jobs first, then by job count descending
  return Array.from(map.values()).sort((a, b) => {
    if (a.staleCount !== b.staleCount) return b.staleCount - a.staleCount;
    return b.jobs.length - a.jobs.length;
  });
}

interface EvalServiceInfo {
  running: boolean;
  pid: number | null;
  pidAlive: boolean;
  activeJobId: string | null;
  activeJobProgress: { gamesProcessed: number; totalGames: number; positionsEvaluated: number; updatedAt?: string } | null;
  queueDepth: number;
  lastCompletedAt: string | null;
  lastError: string | null;
}

function formatElapsed(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function EvalServiceBanner({ staleCount }: { staleCount: number }) {
  const [evalRunning, setEvalRunning] = useState<boolean | null>(null);
  const [serviceInfo, setServiceInfo] = useState<EvalServiceInfo | null>(null);
  const [starting, setStarting] = useState(false);

  const checkStatus = useCallback(() => {
    fetch("/api/eval-service")
      .then((r) => r.json())
      .then((d) => {
        setEvalRunning(d.running);
        setServiceInfo(d);
      })
      .catch(() => setEvalRunning(null));
  }, []);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [checkStatus]);

  async function handleStart() {
    setStarting(true);
    try {
      const res = await fetch("/api/eval-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      setEvalRunning(data.running);
    } catch {}
    setStarting(false);
  }

  // Derive process state from PID, not from DB activity
  const processAlive = serviceInfo?.pidAlive ?? false;
  const processDead = serviceInfo ? !serviceInfo.pidAlive : evalRunning === false;

  if (staleCount === 0 && !processDead) return null;

  return (
    <div className={`rounded-lg border p-3 flex items-start gap-3 ${
      processDead
        ? "border-red-800/60 bg-red-900/20"
        : "border-amber-800/60 bg-amber-900/20"
    }`}>
      <span className={`text-lg leading-none mt-0.5 ${
        processDead ? "text-red-400" : "text-amber-400"
      }`}>!</span>
      <div className="flex-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className={`text-sm font-medium ${
              processDead ? "text-red-300" : "text-amber-300"
            }`}>
              {processDead
                ? `Eval service is not running — ${staleCount} stale job${staleCount !== 1 ? "s" : ""}`
                : `${staleCount} stale job${staleCount !== 1 ? "s" : ""}`}
            </p>
            <p className={`text-xs mt-0.5 ${
              processDead ? "text-red-400/70" : "text-amber-400/70"
            }`}>
              {processDead
                ? "Jobs are piling up with no processor. Start the eval service to begin processing."
                : "Jobs have been pending for over 5 minutes. The eval service may be overloaded."}
            </p>
          </div>
          {processDead ? (
            <button
              onClick={handleStart}
              disabled={starting}
              className="shrink-0 rounded bg-emerald-800 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-700 disabled:opacity-50"
            >
              {starting ? "Starting..." : "Start Eval Service"}
            </button>
          ) : processAlive ? (
            <span className="inline-flex items-center gap-1.5 shrink-0 rounded-full bg-emerald-900/50 px-2.5 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-800/50">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Service Running
            </span>
          ) : null}
        </div>
        {staleCount > 0 && serviceInfo && (
          <div className="mt-2 pt-2 border-t border-amber-800/30 space-y-1">
            <div className="flex items-center gap-3 text-[10px] flex-wrap">
              <span className="text-zinc-500">
                Queue: {serviceInfo.queueDepth} pending
              </span>
              {serviceInfo.lastCompletedAt && (
                <span className="text-zinc-500">
                  Last completed: {formatElapsed(serviceInfo.lastCompletedAt)} ago
                </span>
              )}
            </div>
            {serviceInfo.activeJobProgress && (
              <p className={`text-[10px] ${processDead ? "text-red-300" : "text-amber-300"}`}>
                {processDead ? "Stuck" : "Processing"}: {serviceInfo.activeJobProgress.gamesProcessed}/
                {serviceInfo.activeJobProgress.totalGames} games
                {" "}({serviceInfo.activeJobProgress.positionsEvaluated} positions)
              </p>
            )}
            {serviceInfo.lastError && (
              <p className="text-[10px] text-red-400 truncate">
                Last error: {serviceInfo.lastError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "eval_player", label: "Eval" },
  { value: "oracle", label: "Oracle" },
  { value: "web_search", label: "Search" },
  { value: "web_fetch", label: "Fetch" },
  { value: "code_prompt", label: "Code" },
  { value: "permission", label: "Perms" },
];

export function TaskList() {
  const [data, setData] = useState<TasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const fetchTasks = useCallback(() => {
    const params = new URLSearchParams();
    params.set("status", statusFilter);
    params.set("type", typeFilter);
    fetch(`/api/tasks?${params}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    setLoading(true);
    fetchTasks();
    const interval = setInterval(fetchTasks, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const { toolJobs = [], permissionRequests = [], counts } = data ?? {};
  const totalPending =
    (counts?.pendingToolJobs ?? 0) +
    (counts?.runningToolJobs ?? 0) +
    (counts?.pendingPermissions ?? 0);

  const staleCount = toolJobs.filter(
    (j: any) =>
      j.status === "pending" &&
      Date.now() - new Date(j.created_at).getTime() > STALE_THRESHOLD_MS,
  ).length;

  const agentGroups = groupByAgent(toolJobs);

  return (
    <div className="space-y-4">
      {/* Eval service status + stale warning */}
      <EvalServiceBanner staleCount={staleCount} />

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 rounded bg-zinc-800 p-0.5">
          {(["active", "archived", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded px-2 py-1 text-[10px] font-medium ${
                statusFilter === f
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500"
              }`}
            >
              {f === "active" ? "Active" : f === "archived" ? "Archived" : "All"}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded bg-zinc-800 p-0.5">
          {TYPE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTypeFilter(value)}
              className={`rounded px-2 py-1 text-[10px] font-medium ${
                typeFilter === value
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {totalPending > 0 && (
          <span className="text-xs text-amber-400">
            {totalPending} active
          </span>
        )}
      </div>

      {/* Content */}
      {loading && !data ? (
        <p className="text-xs text-zinc-600">Loading...</p>
      ) : toolJobs.length === 0 && permissionRequests.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            {statusFilter === "active"
              ? "No active tasks. All agents are either running or stopped."
              : statusFilter === "archived"
                ? "No archived tasks."
                : "No tasks found."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Tool jobs grouped by agent */}
          {agentGroups.map((group) => (
            <div key={group.agentName} className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-zinc-300">
                  {group.agentName}
                </h3>
                <span className="text-[10px] text-zinc-600">
                  {group.jobs.length} job{group.jobs.length !== 1 ? "s" : ""}
                </span>
                {group.staleCount > 0 && (
                  <span className="text-[10px] text-red-400">
                    {group.staleCount} stale
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {group.jobs.map((job) => (
                  <ToolJobCard key={`tool-${job.id}`} job={job} />
                ))}
              </div>
            </div>
          ))}

          {/* Permission requests */}
          {permissionRequests.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-zinc-300">
                Permission Requests
              </h3>
              <div className="space-y-2">
                {permissionRequests.map((req: any) => (
                  <PermissionRequestCard key={`perm-${req.id}`} request={req} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

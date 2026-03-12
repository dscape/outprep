"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ForgeSession, ActivityEvent } from "@/lib/forge-types";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { SessionTabs, type Tab } from "./session-tabs";

export function SessionLayout({
  session,
  logs,
  activity,
  isDev,
  created,
  agent,
  allAgents,
}: {
  session: Omit<ForgeSession, "conversationHistory"> & { isRunning?: boolean };
  logs: { filename: string; content: string }[];
  activity: ActivityEvent[];
  isDev: boolean;
  created: string;
  agent?: { id: string; name: string; isRunning: boolean } | null;
  allAgents?: { id: string; name: string; isRunning: boolean }[];
}) {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-xl font-semibold text-zinc-100">
                {session.name}
              </h2>
              <StatusBadge status={session.status} />
              {session.isRunning && (
                <button
                  onClick={() => setTab("console")}
                  className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer transition-colors"
                >
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live
                </button>
              )}
            </div>
            <p className="text-sm text-zinc-500">
              {session.players.join(", ")} &middot; {session.focus} &middot;
              Created {created}
            </p>
            {agent && (
              <p className="text-sm text-zinc-500 mt-1">
                Agent:{" "}
                <Link href={`/forge/agents/${agent.id}`} className="text-zinc-300 hover:text-emerald-400 transition-colors">
                  {agent.name}
                </Link>
                {agent.isRunning && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Running
                  </span>
                )}
              </p>
            )}
          </div>
          <SessionActions
            sessionId={session.id}
            sessionName={session.name}
            isRunning={session.isRunning ?? false}
            currentAgentId={agent?.id ?? null}
            allAgents={allAgents ?? []}
            experimentCount={session.experiments.length}
          />
        </div>
      </div>

      <SessionTabs
        session={session}
        logs={logs}
        activity={activity}
        isDev={isDev}
        tab={tab}
        onTabChange={setTab}
        agent={agent}
      />
    </div>
  );
}

function SessionActions({
  sessionId,
  sessionName,
  isRunning,
  currentAgentId,
  allAgents,
  experimentCount,
}: {
  sessionId: string;
  sessionName: string;
  isRunning: boolean;
  currentAgentId: string | null;
  allAgents: { id: string; name: string; isRunning: boolean }[];
  experimentCount: number;
}) {
  const router = useRouter();
  const [assigning, setAssigning] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const stoppedAgents = allAgents.filter((a) => !a.isRunning);

  async function handleAssign(agentId: string) {
    setAssigning(true);
    try {
      const res = await fetch(`/api/forge/sessions/${sessionId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setAssigning(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/forge/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push("/forge");
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* Assign to Agent */}
      {!isRunning && stoppedAgents.length > 0 && (
        <div className="relative group">
          <button
            disabled={assigning}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            {assigning ? "Assigning..." : "Assign Agent"}
          </button>
          <div className="absolute right-0 top-full mt-1 hidden group-hover:block z-10 w-48 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
            {stoppedAgents.map((a) => (
              <button
                key={a.id}
                onClick={() => handleAssign(a.id)}
                className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 transition-colors ${
                  a.id === currentAgentId ? "text-emerald-400" : "text-zinc-300"
                }`}
              >
                {a.name}
                {a.id === currentAgentId && " (current)"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Delete Session */}
      {!isRunning && (
        <>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/30 transition-colors"
          >
            Delete
          </button>
          {showDeleteConfirm && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
              <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-6 max-w-sm mx-4">
                <h3 className="text-sm font-semibold text-zinc-100 mb-2">
                  Delete Session?
                </h3>
                <p className="text-xs text-zinc-400 mb-4">
                  Delete &ldquo;{sessionName}&rdquo;? This will remove{" "}
                  {experimentCount} experiment{experimentCount !== 1 ? "s" : ""} and
                  destroy the sandbox. This action cannot be undone.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

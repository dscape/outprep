"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SessionSummary } from "@/lib/forge-types";
import { StatusBadge } from "./StatusBadge";
import { CostDisplay } from "./CostDisplay";

function formatDate(date: Date): string {
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return `${month} ${day}, ${h.toString().padStart(2, "0")}:${minutes} ${ampm}`;
}

export function SessionCard({ session }: { session: SessionSummary }) {
  const router = useRouter();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updated, setUpdated] = useState("");

  useEffect(() => {
    setUpdated(formatDate(new Date(session.updatedAt)));
  }, [session.updatedAt]);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  return (
    <div className="relative">
      <Link
        href={`/${session.id}`}
        className="block rounded-lg border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all group"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white">
              {session.name}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {session.agentName && (
                <span className="text-zinc-400 font-medium">{session.agentName} &middot; </span>
              )}
              {session.players.join(", ")} &middot; {session.focus}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!session.isRunning && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                className="opacity-0 group-hover:opacity-100 rounded p-1 text-zinc-500 hover:text-red-400 hover:bg-red-950/30 transition-all"
                title="Delete session"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            )}
            <StatusBadge status={session.status} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-zinc-500 text-xs">Experiments</p>
            <p className="font-mono text-zinc-300">{session.experimentCount}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Oracle</p>
            <p className="font-mono text-zinc-300">{session.oracleCount}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Cost</p>
            <CostDisplay
              costUsd={session.totalCostUsd}
              inputTokens={session.totalInputTokens}
              outputTokens={session.totalOutputTokens}
              compact
            />
          </div>
        </div>

        {session.bestCompositeScore !== null && (
          <div className="mt-3 pt-3 border-t border-zinc-800">
            <p className="text-xs text-zinc-500">
              Best composite:{" "}
              <span className="font-mono text-emerald-400">
                {session.bestCompositeScore.toFixed(3)}
              </span>
            </p>
          </div>
        )}

        {updated && <p className="text-xs text-zinc-600 mt-3">Updated {updated}</p>}
      </Link>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-6 max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-zinc-100 mb-2">
              Delete Session?
            </h3>
            <p className="text-xs text-zinc-400 mb-4">
              Delete &ldquo;{session.name}&rdquo;? This will remove{" "}
              {session.experimentCount} experiment{session.experimentCount !== 1 ? "s" : ""} and
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
    </div>
  );
}

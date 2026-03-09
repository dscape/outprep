"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionStatus } from "@/lib/forge-types";

export function SessionControls({
  sessionId,
  status,
  onTabChange,
}: {
  sessionId: string;
  status: SessionStatus;
  onTabChange?: (tab: string) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResume() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/forge/sessions/${sessionId}/resume`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to resume");
      }
      onTabChange?.("console");
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/forge/sessions/${sessionId}/stop`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to stop");
      }
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {(status === "paused" || status === "abandoned") && (
        <button
          onClick={handleResume}
          disabled={loading}
          className="px-3 py-1.5 rounded bg-emerald-800/50 border border-emerald-700/50 text-sm text-emerald-300 hover:bg-emerald-700/50 disabled:opacity-50 transition-colors"
        >
          {loading ? "Resuming..." : "Resume"}
        </button>
      )}

      {status === "active" && (
        <>
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
          <button
            onClick={handleStop}
            disabled={loading}
            className="px-3 py-1.5 rounded bg-red-800/50 border border-red-700/50 text-sm text-red-300 hover:bg-red-700/50 disabled:opacity-50 transition-colors"
          >
            {loading ? "Stopping..." : "Stop"}
          </button>
        </>
      )}

      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

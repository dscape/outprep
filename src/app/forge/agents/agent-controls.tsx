"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface AgentControlsProps {
  hasAgents: boolean;
  hasStoppedAgents: boolean;
  hasRunningAgents: boolean;
}

export function AgentControls({ hasAgents, hasStoppedAgents, hasRunningAgents }: AgentControlsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleStopAll() {
    setLoading("stop");
    try {
      await fetch("/api/forge/agents/stop-all", { method: "POST" });
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(null);
    }
  }

  async function handleStartAll() {
    setLoading("start");
    try {
      await fetch("/api/forge/agents/start-all", { method: "POST" });
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(null);
    }
  }

  if (!hasAgents) return null;

  return (
    <div className="flex gap-2">
      {hasStoppedAgents && (
        <button
          onClick={handleStartAll}
          disabled={loading !== null}
          className="rounded bg-emerald-800 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading === "start" ? "Starting..." : "Start All"}
        </button>
      )}
      {hasRunningAgents && (
        <button
          onClick={handleStopAll}
          disabled={loading !== null}
          className="rounded bg-red-800 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-700 disabled:opacity-50"
        >
          {loading === "stop" ? "Stopping..." : "Stop All"}
        </button>
      )}
    </div>
  );
}

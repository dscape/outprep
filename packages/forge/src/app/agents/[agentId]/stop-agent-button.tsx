"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "confirming" | "stopping";

export function StopAgentButton({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if (phase !== "confirming") return;
    const timer = setTimeout(() => setPhase("idle"), 3000);
    return () => clearTimeout(timer);
  }, [phase]);

  async function handleClick() {
    if (phase === "idle") {
      setPhase("confirming");
      return;
    }
    if (phase === "confirming") {
      setPhase("stopping");
      try {
        await fetch(`/api/agents/${agentId}/stop`, { method: "POST" });
      } finally {
        router.refresh();
      }
    }
  }

  const label = phase === "idle" ? "Stop Agent" : phase === "confirming" ? "Confirm Stop?" : "Stopping...";
  const style = phase === "confirming"
    ? "bg-red-700 text-red-100 border-red-600 hover:bg-red-600"
    : "bg-zinc-800 text-red-400 border-zinc-700 hover:bg-zinc-700";

  return (
    <button
      onClick={handleClick}
      disabled={phase === "stopping"}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${style}`}
    >
      {label}
    </button>
  );
}

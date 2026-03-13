"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "confirming" | "starting";

export function StartAgentButton({ agentId }: { agentId: string }) {
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
      setPhase("starting");
      try {
        await fetch(`/api/agents/${agentId}/start`, { method: "POST" });
      } finally {
        router.refresh();
      }
    }
  }

  const label = phase === "idle" ? "Start Agent" : phase === "confirming" ? "Confirm Start?" : "Starting...";
  const style = phase === "confirming"
    ? "bg-emerald-700 text-emerald-100 border-emerald-600 hover:bg-emerald-600"
    : "bg-zinc-800 text-emerald-400 border-zinc-700 hover:bg-zinc-700";

  return (
    <button
      onClick={handleClick}
      disabled={phase === "starting"}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${style}`}
    >
      {label}
    </button>
  );
}

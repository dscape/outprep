"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const FOCUS_AREAS = ["accuracy", "cpl", "blunders", "opening", "middlegame", "endgame"];

interface PlayerMeta {
  username: string;
  estimatedElo: number;
  gameCount: number;
}

type Mode = "autonomous" | "fixed";

export function NewAgentDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("autonomous");
  const [players, setPlayers] = useState<PlayerMeta[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState("accuracy");
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [researchBias, setResearchBias] = useState(0.5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingPlayers(true);
    fetch("/api/forge/players")
      .then((r) => r.json())
      .then((data) => setPlayers(data))
      .catch(() => {})
      .finally(() => setLoadingPlayers(false));
  }, []);

  function togglePlayer(username: string) {
    setSelectedPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);

    if (mode === "fixed" && selectedPlayers.size === 0) {
      setError("Select at least one player.");
      return;
    }

    setSubmitting(true);
    try {
      const body =
        mode === "autonomous"
          ? { researchBias }
          : { players: [...selectedPlayers], focus, researchBias };

      const res = await fetch("/api/forge/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }

      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-zinc-100 mb-4">New Agent</h3>

        {/* Mode toggle */}
        <div className="flex gap-1 rounded-md bg-zinc-800 p-1 mb-4">
          <button
            onClick={() => setMode("autonomous")}
            className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "autonomous"
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Autonomous
          </button>
          <button
            onClick={() => setMode("fixed")}
            className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "fixed"
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Fixed
          </button>
        </div>

        {/* Research Strategy */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-zinc-400 mb-2">Research Strategy</label>
          <div className="flex gap-1 rounded-md bg-zinc-800 p-1">
            {([
              { value: 0.0, label: "Conservative", desc: "Careful, incremental changes" },
              { value: 0.5, label: "Balanced", desc: "Mix of safe and bold experiments" },
              { value: 1.0, label: "Aggressive", desc: "Bold, high-risk experiments" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setResearchBias(opt.value)}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                  researchBias === opt.value
                    ? opt.value === 0.0
                      ? "bg-blue-900/50 text-blue-300"
                      : opt.value === 1.0
                      ? "bg-red-900/50 text-red-300"
                      : "bg-amber-900/50 text-amber-300"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
                title={opt.desc}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-zinc-600">
            {researchBias === 0.0
              ? "Careful, incremental improvements with strong evidence"
              : researchBias === 1.0
              ? "Bold, high-risk experiments seeking breakthroughs"
              : "Balanced mix of safe and bold experiments"}
          </p>
        </div>

        {mode === "autonomous" ? (
          <p className="text-xs text-zinc-500 mb-4">
            Agent will autonomously decide which players and focus areas to work on.
          </p>
        ) : (
          <div className="space-y-4 mb-4">
            {/* Players */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2">Players</label>
              {loadingPlayers ? (
                <p className="text-xs text-zinc-600">Loading players...</p>
              ) : players.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  No player data.{" "}
                  <a href="/forge/data" className="text-emerald-400 hover:underline">
                    Add players from the Data tab
                  </a>{" "}
                  first.
                </p>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {players.map((p) => (
                    <label
                      key={p.username}
                      className="flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPlayers.has(p.username)}
                        onChange={() => togglePlayer(p.username)}
                        className="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/30"
                      />
                      <span className="text-xs text-zinc-300">{p.username}</span>
                      <span className="text-xs text-zinc-600">Elo ~{p.estimatedElo}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Focus */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Focus</label>
              <select
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
              >
                {FOCUS_AREAS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded bg-emerald-800 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? "Starting..." : "Start Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewSessionDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [players, setPlayers] = useState("");
  const [focus, setFocus] = useState("accuracy");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const playerList = players
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    if (playerList.length === 0) {
      setError("At least one player username is required");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/forge/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || undefined,
          players: playerList,
          focus,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start session");
      }

      onClose();
      // Refresh the page to show new session
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6">
        <h3 className="text-sm font-medium text-zinc-100 mb-4">
          New Forge Session
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">
              Session Name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. accuracy-experiment-2"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">
              Players (comma-separated Lichess usernames)
            </label>
            <input
              type="text"
              value={players}
              onChange={(e) => setPlayers(e.target.value)}
              placeholder="e.g. benjoboli, fins"
              required
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Focus</label>
            <select
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            >
              <option value="accuracy">Accuracy</option>
              <option value="cpl">CPL Distribution</option>
              <option value="blunders">Blunder Profile</option>
              <option value="opening">Opening</option>
              <option value="endgame">Endgame</option>
            </select>
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 rounded bg-zinc-700 text-sm text-zinc-100 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Starting..." : "Start Session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

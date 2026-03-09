"use client";

import { useState } from "react";

export function AddPlayerForm({ onAdded }: { onAdded: () => void }) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/forge/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch player");
      }

      setUsername("");
      onAdded();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 mb-6">
      <div className="flex-1">
        <label className="block text-xs text-zinc-500 mb-1">
          Add Lichess Player
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. DrNykterstein"
          disabled={loading}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
        />
      </div>
      <button
        type="submit"
        disabled={loading || !username.trim()}
        className="px-3 py-2 rounded bg-zinc-700 text-sm text-zinc-100 hover:bg-zinc-600 disabled:opacity-50 transition-colors whitespace-nowrap"
      >
        {loading ? "Fetching..." : "Fetch Games"}
      </button>
      {error && <p className="text-xs text-red-400 ml-2">{error}</p>}
    </form>
  );
}

"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function SearchInput() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;

    setLoading(true);
    setError("");

    try {
      // Quick check that the user exists
      const res = await fetch(`/api/lichess/${encodeURIComponent(trimmed)}?type=user`);
      if (res.status === 404) {
        setError(`Player "${trimmed}" not found on Lichess`);
        setLoading(false);
        return;
      }
      if (res.status === 429) {
        setError("Rate limited. Please wait a moment and try again.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      router.push(`/scout/${encodeURIComponent(trimmed)}`);
    } catch {
      setError("Network error. Please check your connection.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md" autoComplete="off">
      <div className="relative">
        <input
          type="search"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setError("");
          }}
          placeholder="Enter Lichess username..."
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 pr-28 text-white placeholder-zinc-500 outline-none transition-colors focus:border-green-500 focus:ring-1 focus:ring-green-500"
          disabled={loading}
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="absolute right-1.5 top-1.5 rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Checking
            </span>
          ) : (
            "Scout"
          )}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-400">{error}</p>
      )}
    </form>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface PlayerMeta {
  username: string;
  estimatedElo: number;
  gameCount: number;
  fetchedAt: string;
}

const FOCUS_OPTIONS = [
  { value: "accuracy", label: "Accuracy" },
  { value: "cpl", label: "CPL Distribution" },
  { value: "blunders", label: "Blunder Profile" },
  { value: "opening", label: "Opening" },
  { value: "middlegame", label: "Middlegame" },
  { value: "endgame", label: "Endgame" },
] as const;

export function NewSessionDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(
    new Set()
  );
  const [focusAreas, setFocusAreas] = useState<Set<string>>(
    new Set(["accuracy"])
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cached players from the server
  const [cachedPlayers, setCachedPlayers] = useState<PlayerMeta[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);

  useEffect(() => {
    fetch("/api/forge/players")
      .then((r) => r.json())
      .then((data) => setCachedPlayers(data))
      .catch(() => {})
      .finally(() => setLoadingPlayers(false));
  }, []);

  // Auto-generate name from selected players + focus
  useEffect(() => {
    if (nameManuallyEdited) return;

    const players = [...selectedPlayers].sort();
    const focuses = [...focusAreas].sort();

    if (players.length === 0) {
      setName("");
      return;
    }

    const generated = `${players.join("-")}-${focuses.join("-")}`;
    setName(generated.length > 50 ? generated.slice(0, 50) : generated);
  }, [selectedPlayers, focusAreas, nameManuallyEdited]);

  function togglePlayer(username: string) {
    setSelectedPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  }

  function toggleFocus(value: string) {
    setFocusAreas((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        // Don't allow unchecking the last item
        if (next.size <= 1) return prev;
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (selectedPlayers.size === 0) {
      setError("Select at least one player");
      return;
    }

    setSubmitting(true);

    try {
      // Snapshot existing session IDs before creating
      let existingIds = new Set<string>();
      try {
        const existing = await fetch("/api/forge/sessions");
        if (existing.ok) {
          const sessions = await existing.json();
          existingIds = new Set(sessions.map((s: { id: string }) => s.id));
        }
      } catch {}

      const res = await fetch("/api/forge/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || undefined,
          players: [...selectedPlayers],
          focus: [...focusAreas].join(","),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to start session");
      }

      const sessionName = name || data.sessionId;

      onClose();

      // Poll for the new session to appear in forge-state (CLI writes it async)
      const pollForSession = async () => {
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          router.refresh();
          try {
            const stateRes = await fetch("/api/forge/sessions");
            if (!stateRes.ok) continue;
            const sessions = await stateRes.json();
            // Match by name
            const match = sessions.find(
              (s: { name: string }) => s.name === sessionName
            );
            if (match) {
              router.push(`/forge/${match.id}`);
              return;
            }
            // Fallback: find any session that didn't exist before
            const newSession = sessions.find(
              (s: { id: string }) => !existingIds.has(s.id)
            );
            if (newSession) {
              router.push(`/forge/${newSession.id}`);
              return;
            }
          } catch {}
        }
      };
      pollForSession();
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
              Session Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                const val = e.target.value;
                setName(val);
                if (val === "") {
                  setNameManuallyEdited(false);
                } else {
                  setNameManuallyEdited(true);
                }
              }}
              placeholder="auto-generated from selections"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-2">Players</label>
            {loadingPlayers ? (
              <p className="text-xs text-zinc-600">Loading players...</p>
            ) : cachedPlayers.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No cached players.{" "}
                <a
                  href="/forge/data"
                  className="text-zinc-400 underline hover:text-zinc-200"
                >
                  Fetch player games first
                </a>
                .
              </p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto rounded border border-zinc-800 bg-zinc-800/50 p-2">
                {cachedPlayers.map((p) => (
                  <label
                    key={p.username}
                    className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-700/50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPlayers.has(p.username)}
                      onChange={() => togglePlayer(p.username)}
                      className="rounded border-zinc-600 bg-zinc-700 text-zinc-400 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className="text-sm text-zinc-200">{p.username}</span>
                    <span className="text-xs text-zinc-500 ml-auto">
                      {p.estimatedElo} Elo · {p.gameCount} games
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-2">Focus</label>
            <div className="grid grid-cols-2 gap-1 rounded border border-zinc-800 bg-zinc-800/50 p-2">
              {FOCUS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-700/50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={focusAreas.has(opt.value)}
                    onChange={() => toggleFocus(opt.value)}
                    className="rounded border-zinc-600 bg-zinc-700 text-zinc-400 focus:ring-0 focus:ring-offset-0"
                  />
                  <span className="text-sm text-zinc-200">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

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
              disabled={submitting || selectedPlayers.size === 0}
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

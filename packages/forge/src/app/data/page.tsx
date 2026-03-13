"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { AddPlayerForm } from "@/components/AddPlayerForm";

interface PlayerMeta {
  username: string;
  estimatedElo: number;
  gameCount: number;
  contentHash: string;
  fetchedAt: string;
}

export default function ForgeDataPage() {
  const [players, setPlayers] = useState<PlayerMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPlayers = useCallback(async () => {
    try {
      const res = await fetch("/api/players");
      if (res.ok) {
        setPlayers(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlayers();
  }, [loadPlayers]);

  return (
    <div>
      <h2 className="text-sm font-medium text-zinc-400 mb-4">
        Game Archives
      </h2>

      <AddPlayerForm onAdded={loadPlayers} />

      {loading ? (
        <div className="text-center py-16 text-zinc-500 text-sm">
          Loading...
        </div>
      ) : players.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm">
          No game data found. Use the form above to fetch player games.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((p) => (
            <Link
              key={p.username}
              href={`/data/${p.username.toLowerCase()}`}
              className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 hover:bg-zinc-800/50 transition-colors"
            >
              <p className="text-sm font-medium text-zinc-100">{p.username}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-zinc-500">Elo</p>
                  <p className="font-mono text-zinc-300">{p.estimatedElo}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Games</p>
                  <p className="font-mono text-zinc-300">{p.gameCount}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-zinc-600">
                Fetched {new Date(p.fetchedAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

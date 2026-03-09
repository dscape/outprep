import Link from "next/link";
import { listGamePlayers } from "@/lib/forge";

export const revalidate = 0;

export default function ForgeDataPage() {
  const players = listGamePlayers();

  return (
    <div>
      <h2 className="text-sm font-medium text-zinc-400 mb-4">
        Game Archives
      </h2>

      {players.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm">
          No game data found. Run forge to fetch player games.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((p) => (
            <Link
              key={p.username}
              href={`/forge/data/${p.username.toLowerCase()}`}
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

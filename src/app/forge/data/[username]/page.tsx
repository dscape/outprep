import Link from "next/link";
import { listGamePlayers, getPlayerGames } from "@/lib/forge";

export const revalidate = 0;

interface LichessPlayer {
  user: { name: string; id: string };
  rating: number;
  ratingDiff?: number;
}

interface LichessGame {
  id: string;
  rated: boolean;
  speed: string;
  createdAt: number;
  status: string;
  winner?: string;
  players: { white: LichessPlayer; black: LichessPlayer };
  opening?: { eco: string; name: string };
}

export default async function PlayerDataPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { username } = await params;
  const { page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr || "1", 10));
  const limit = 50;

  const players = listGamePlayers();
  const meta = players.find(
    (p) => p.username.toLowerCase() === username.toLowerCase()
  );

  if (!meta) {
    return (
      <div className="text-center py-16 text-zinc-500 text-sm">
        Player &quot;{username}&quot; not found.
      </div>
    );
  }

  const { games: rawGames, total } = getPlayerGames(username, page, limit);
  const games = rawGames as LichessGame[];
  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <Link
        href="/forge/data"
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        &larr; All Players
      </Link>

      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-zinc-100">{meta.username}</h2>
        <div className="mt-2 flex gap-6 text-sm text-zinc-400">
          <span>
            Elo: <span className="font-mono text-zinc-200">{meta.estimatedElo}</span>
          </span>
          <span>
            Games: <span className="font-mono text-zinc-200">{meta.gameCount}</span>
          </span>
          <span>
            Fetched: {new Date(meta.fetchedAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      {games.length === 0 ? (
        <div className="text-center py-12 text-zinc-500 text-sm">
          No games found.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                  <th className="py-2 pr-4 text-left font-medium">Date</th>
                  <th className="py-2 pr-4 text-left font-medium">White</th>
                  <th className="py-2 pr-4 text-left font-medium">Black</th>
                  <th className="py-2 pr-4 text-left font-medium">Result</th>
                  <th className="py-2 pr-4 text-left font-medium">Opening</th>
                  <th className="py-2 pr-4 text-left font-medium">Speed</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g) => {
                  const isWhite =
                    g.players.white.user.id.toLowerCase() === username.toLowerCase();
                  const result = !g.winner
                    ? "Draw"
                    : (g.winner === "white") === isWhite
                      ? "Win"
                      : "Loss";
                  const resultColor =
                    result === "Win"
                      ? "text-emerald-400"
                      : result === "Loss"
                        ? "text-red-400"
                        : "text-zinc-400";

                  return (
                    <tr
                      key={g.id}
                      className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                    >
                      <td className="py-2 pr-4 text-zinc-400 font-mono text-xs">
                        {new Date(g.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2 pr-4 text-zinc-300">
                        {g.players.white.user.name}{" "}
                        <span className="text-zinc-500 text-xs">
                          ({g.players.white.rating})
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-zinc-300">
                        {g.players.black.user.name}{" "}
                        <span className="text-zinc-500 text-xs">
                          ({g.players.black.rating})
                        </span>
                      </td>
                      <td className={`py-2 pr-4 font-medium ${resultColor}`}>
                        {result}
                      </td>
                      <td className="py-2 pr-4 text-zinc-400 text-xs">
                        {g.opening?.name || "—"}
                      </td>
                      <td className="py-2 pr-4 text-zinc-500 text-xs">
                        {g.speed}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-zinc-500">
                Page {page} of {totalPages} ({total} games)
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`/forge/data/${username}?page=${page - 1}`}
                    className="px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/forge/data/${username}?page=${page + 1}`}
                    className="px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

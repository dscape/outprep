"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { PlayerProfile } from "@/lib/types";
import ChessBoard from "@/components/ChessBoard";

export default function PlayPage() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [openingBook, setOpeningBook] = useState<Uint8Array | null>(null);
  const [playerColor, setPlayerColor] = useState<"white" | "black" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        // Fetch profile and opening book in parallel
        const [profileRes, bookRes] = await Promise.all([
          fetch(`/api/profile/${encodeURIComponent(username)}`),
          fetch(`/api/opening-book/${encodeURIComponent(username)}`),
        ]);

        if (!profileRes.ok) {
          const data = await profileRes.json();
          setError(data.error || "Failed to load profile");
          setLoading(false);
          return;
        }

        const profileData = await profileRes.json();
        setProfile(profileData);

        if (bookRes.ok) {
          const bookBuffer = await bookRes.arrayBuffer();
          setOpeningBook(new Uint8Array(bookBuffer));
        }
      } catch {
        setError("Failed to load game data.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [username]);

  const handleGameEnd = useCallback((pgn: string, result: string) => {
    const gameId = uuidv4();

    // Store game data in sessionStorage for the analysis page
    sessionStorage.setItem(
      `game:${gameId}`,
      JSON.stringify({
        pgn,
        result,
        playerColor,
        opponentUsername: username,
        opponentFideEstimate: profile?.fideEstimate.rating,
      })
    );

    router.push(`/analysis/${gameId}`);
  }, [playerColor, username, profile, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 mx-auto rounded-full border-2 border-green-500 border-t-transparent animate-spin mb-4" />
          <p className="text-zinc-400">Loading opponent data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-xl font-bold text-white mb-2">Error</h2>
          <p className="text-zinc-400 mb-4">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700"
          >
            Back to search
          </button>
        </div>
      </div>
    );
  }

  // Color selection screen
  if (!playerColor) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">
            Play against {profile?.username}
          </h2>
          <p className="text-zinc-400 mb-8">
            ~{profile?.fideEstimate.rating} FIDE estimated
          </p>

          <p className="text-sm text-zinc-500 mb-4">Choose your color</p>

          <div className="flex gap-4 justify-center">
            <button
              onClick={() => setPlayerColor("white")}
              className="group relative rounded-xl border border-zinc-700 bg-zinc-800/50 p-6 transition-all hover:border-green-500 hover:bg-zinc-800"
            >
              <div className="text-5xl mb-2">&#9812;</div>
              <span className="text-sm font-medium text-zinc-300 group-hover:text-white">
                White
              </span>
            </button>
            <button
              onClick={() => setPlayerColor("black")}
              className="group relative rounded-xl border border-zinc-700 bg-zinc-800/50 p-6 transition-all hover:border-green-500 hover:bg-zinc-800"
            >
              <div className="text-5xl mb-2">&#9818;</div>
              <span className="text-sm font-medium text-zinc-300 group-hover:text-white">
                Black
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => router.push(`/scout/${encodeURIComponent(username)}`)}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            &larr; Back to scout
          </button>
          <h1 className="text-lg font-medium text-white">
            vs {profile?.username}
          </h1>
        </div>

        <ChessBoard
          playerColor={playerColor}
          opponentUsername={profile?.username || username}
          openingBook={openingBook}
          fideEstimate={profile?.fideEstimate.rating || 1500}
          onGameEnd={handleGameEnd}
        />
      </div>
    </div>
  );
}

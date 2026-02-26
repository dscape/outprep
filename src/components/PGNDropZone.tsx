"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { OTBGame } from "@/lib/types";
import {
  parseAllPGNGames,
  inferPlayer,
  InferResult,
} from "@/lib/pgn-parser";
import { analyzeOTBGames } from "@/lib/otb-analyzer";

type Phase = "idle" | "picking";

export default function PGNDropZone() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [showTextarea, setShowTextarea] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [games, setGames] = useState<OTBGame[]>([]);
  const [inferResult, setInferResult] = useState<InferResult | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Run analysis and navigate — takes params directly (not from state) */
  const runAnalysis = useCallback(
    (playerName: string, allGames: OTBGame[]) => {
      setAnalyzing(true);
      setError("");

      setTimeout(() => {
        try {
          const playerLower = playerName.toLowerCase();
          const playerGames = allGames.filter(
            (g) =>
              g.white.trim().toLowerCase().includes(playerLower) ||
              g.black.trim().toLowerCase().includes(playerLower)
          );

          if (playerGames.length === 0) {
            setError("No games found for the selected player.");
            setAnalyzing(false);
            return;
          }

          const profile = analyzeOTBGames(playerGames, playerName);

          try {
            sessionStorage.setItem(
              `pgn-import:${playerName}`,
              JSON.stringify(profile)
            );
          } catch {
            setError("Unable to store game data. Try a smaller PGN file.");
            setAnalyzing(false);
            return;
          }

          router.push(
            `/scout/${encodeURIComponent(playerName)}?source=pgn`
          );
        } catch (err) {
          setError(
            `Analysis failed: ${err instanceof Error ? err.message : "Unknown error"}`
          );
          setAnalyzing(false);
        }
      }, 50);
    },
    [router]
  );

  const processPGN = useCallback(
    (text: string) => {
      setError("");

      // Run in microtask to avoid blocking UI on large PGNs
      setTimeout(() => {
        const parsed = parseAllPGNGames(text);
        if (parsed.length === 0) {
          setError("No valid games found in this PGN.");
          return;
        }

        setGames(parsed);
        const result = inferPlayer(parsed);
        setInferResult(result);

        if (result.player) {
          // Confident inference → analyze immediately, no intermediate UI
          setSelectedPlayer(result.player);
          runAnalysis(result.player, parsed);
        } else if (result.candidates.length > 0) {
          setSelectedPlayer(result.candidates[0].name);
          setPhase("picking");
        } else {
          setError("Could not identify any players in this PGN.");
        }
      }, 50);
    },
    [runAnalysis]
  );

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) {
          setError("Could not read file.");
          return;
        }
        processPGN(text);
      };
      reader.onerror = () => setError("Failed to read file.");
      reader.readAsText(file);
    },
    [processPGN]
  );

  const handleClear = useCallback(() => {
    setPhase("idle");
    setGames([]);
    setInferResult(null);
    setSelectedPlayer(null);
    setError("");
    setShowTextarea(false);
    setPasteText("");
    setAnalyzing(false);
  }, []);

  // Picking: player ambiguous
  if (phase === "picking" && inferResult) {
    const candidates = inferResult.candidates.slice(0, 10);

    return (
      <div className="w-full rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-5">
        <div className="text-sm text-zinc-300">
          <span className="font-medium text-green-400">
            {games.length} game{games.length !== 1 ? "s" : ""}
          </span>{" "}
          found. Select the player to scout:
        </div>

        <div className="mt-3 space-y-1.5">
          {candidates.map((c) => (
            <label
              key={c.name}
              className={`flex items-center gap-3 rounded-md px-3 py-2 cursor-pointer transition-colors ${
                selectedPlayer?.toLowerCase() === c.name.toLowerCase()
                  ? "bg-green-600/10 border border-green-500/30"
                  : "hover:bg-zinc-700/30 border border-transparent"
              }`}
            >
              <input
                type="radio"
                name="player"
                checked={
                  selectedPlayer?.toLowerCase() === c.name.toLowerCase()
                }
                onChange={() => setSelectedPlayer(c.name)}
                className="accent-green-500"
              />
              <span className="text-sm text-white">{c.name}</span>
              <span className="text-xs text-zinc-500">
                {c.games} game{c.games !== 1 ? "s" : ""}
              </span>
            </label>
          ))}
          {inferResult.candidates.length > 10 && (
            <div className="px-3 py-1 text-xs text-zinc-500">
              and {inferResult.candidates.length - 10} more...
            </div>
          )}
        </div>

        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => {
              if (selectedPlayer) runAnalysis(selectedPlayer, games);
            }}
            disabled={analyzing || !selectedPlayer}
            className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {analyzing ? "Analyzing..." : "Analyze"}
          </button>
          <button
            onClick={handleClear}
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
    );
  }

  // Idle: drop zone (also shown during auto-analyze with inline status)
  return (
    <div className="w-full">
      {analyzing && (
        <div className="mb-3 rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-4 py-3 text-sm text-zinc-300">
          <span className="text-green-400">Analyzing</span>{" "}
          {games.length} game{games.length !== 1 ? "s" : ""}
          {selectedPlayer && (
            <>
              {" "}for <span className="font-medium text-white">{selectedPlayer}</span>
            </>
          )}
          <span className="ml-1 animate-pulse">...</span>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file && file.name.endsWith(".pgn")) {
            handleFile(file);
          } else {
            setError("Please drop a .pgn file.");
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text/plain");
          if (text && text.length > 10) {
            e.preventDefault();
            setPasteText(text);
            processPGN(text);
          }
        }}
        className={`rounded-lg border-2 border-dashed p-5 text-center transition-colors ${
          dragOver
            ? "border-green-500 bg-green-500/5"
            : "border-zinc-700/50 bg-zinc-800/30"
        }`}
      >
        <div className="text-sm text-zinc-400">
          Drop a .pgn file here
          {!showTextarea && (
            <>
              {", "}
              <button
                onClick={() => setShowTextarea(true)}
                className="text-green-400 hover:text-green-300 transition-colors"
              >
                paste PGN text
              </button>
              {", or "}
              <button
                onClick={() => fileRef.current?.click()}
                className="text-green-400 hover:text-green-300 transition-colors"
              >
                choose a file
              </button>
            </>
          )}
        </div>

        {showTextarea && (
          <div className="mt-3">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste PGN text here..."
              rows={5}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900/50 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-green-500 resize-y font-mono"
              autoFocus
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => {
                  if (pasteText.trim()) processPGN(pasteText.trim());
                }}
                disabled={!pasteText.trim()}
                className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Process
              </button>
              <button
                onClick={() => {
                  setShowTextarea(false);
                  setPasteText("");
                  setError("");
                }}
                className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".pgn"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            if (e.target) e.target.value = "";
          }}
        />
      </div>

      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
    </div>
  );
}

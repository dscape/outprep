"use client";

import { useState, useCallback, useRef } from "react";
import { OTBProfile } from "@/lib/types";
import { parsePGNFile } from "@/lib/pgn-parser";
import { analyzeOTBGames } from "@/lib/otb-analyzer";

interface OTBUploaderProps {
  username: string;
  onProfileReady: (profile: OTBProfile) => void;
  existingProfile: OTBProfile | null;
  onClear: () => void;
}

export default function OTBUploader({
  username,
  onProfileReady,
  existingProfile,
  onClear,
}: OTBUploaderProps) {
  const [playerName, setPlayerName] = useState(username);
  const [fileName, setFileName] = useState("");
  const [gameCount, setGameCount] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pgnTextRef = useRef<string>("");

  const handleFile = useCallback(
    (file: File) => {
      setError("");
      setFileName(file.name);

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) {
          setError("Could not read file.");
          return;
        }

        pgnTextRef.current = text;

        // Parse to count new games
        const games = parsePGNFile(text, playerName);
        setGameCount(games.length);

        if (games.length === 0) {
          setError(
            `No games found for "${playerName}". Check the player name matches the PGN.`
          );
        }
      };
      reader.onerror = () => setError("Failed to read file.");
      reader.readAsText(file);
    },
    [playerName]
  );

  const handleAnalyze = useCallback(() => {
    if (!pgnTextRef.current || gameCount === 0) return;

    setAnalyzing(true);
    setError("");

    // Run analysis in a microtask to avoid blocking UI
    setTimeout(() => {
      try {
        const newGames = parsePGNFile(pgnTextRef.current, playerName);

        // Merge with existing games, deduplicating by PGN content
        const existingGames = existingProfile?.games || [];
        const existingPGNs = new Set(existingGames.map((g) => g.pgn));
        const uniqueNewGames = newGames.filter((g) => !existingPGNs.has(g.pgn));
        const allGames = [...existingGames, ...uniqueNewGames];

        const dupes = newGames.length - uniqueNewGames.length;

        if (uniqueNewGames.length === 0 && dupes > 0) {
          setError(
            `All ${dupes} game${dupes !== 1 ? "s" : ""} already exist. Upload a different file.`
          );
          setAnalyzing(false);
          return;
        }

        const profile = analyzeOTBGames(allGames, playerName);
        onProfileReady(profile);

        // Reset file state after successful add
        pgnTextRef.current = "";
        setFileName("");
        setGameCount(0);
      } catch (err) {
        setError(
          `Analysis failed: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      } finally {
        setAnalyzing(false);
      }
    }, 50);
  }, [gameCount, playerName, existingProfile, onProfileReady]);

  const handleReparse = useCallback(() => {
    if (!pgnTextRef.current) return;
    setError("");
    const games = parsePGNFile(pgnTextRef.current, playerName);
    setGameCount(games.length);
    if (games.length === 0) {
      setError(
        `No games found for "${playerName}". Check the player name matches the PGN.`
      );
    }
  }, [playerName]);

  // Upload zone (shared between initial and add-more states)
  const uploadZone = (
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
          setError("Please upload a .pgn file.");
        }
      }}
      className={`rounded-lg border-2 border-dashed p-5 transition-colors ${
        dragOver
          ? "border-green-500 bg-green-500/5"
          : "border-zinc-700/50 bg-zinc-800/30"
      }`}
    >
      <div className="text-sm font-medium text-zinc-300 mb-3">
        {existingProfile ? "Add More OTB Games (PGN)" : "Upload OTB Games (PGN)"}
      </div>

      {/* Player name input */}
      <div className="mb-3">
        <label className="block text-xs text-zinc-500 mb-1">
          Player name (as it appears in PGN)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            onBlur={handleReparse}
            placeholder="e.g. Goncalves, Beatriz"
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-900/50 px-3 py-1.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-green-500"
          />
        </div>
      </div>

      {/* File input */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-600 transition-colors"
        >
          Choose File
        </button>
        <span className="text-sm text-zinc-500">
          {fileName
            ? `${fileName} — ${gameCount} new game${gameCount !== 1 ? "s" : ""} found`
            : "or drag & drop a .pgn file"}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".pgn"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // Reset input so re-uploading the same file triggers onChange
            if (e.target) e.target.value = "";
          }}
        />
      </div>

      {/* Error */}
      {error && <div className="mt-3 text-sm text-red-400">{error}</div>}

      {/* Analyze button */}
      {gameCount > 0 && (
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="mt-3 rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {analyzing
            ? "Analyzing..."
            : existingProfile
              ? `Add ${gameCount} games`
              : `Analyze ${gameCount} games`}
        </button>
      )}
    </div>
  );

  // When existing profile exists, show summary + upload zone for adding more
  if (existingProfile) {
    return (
      <div className="mt-4 space-y-3">
        {/* Summary bar */}
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-zinc-300">
            <span className="font-medium text-green-400">OTB:</span>{" "}
            {existingProfile.totalGames} game{existingProfile.totalGames !== 1 ? "s" : ""} analyzed
          </div>
          <button
            onClick={() => {
              onClear();
              setFileName("");
              setGameCount(0);
              setError("");
              pgnTextRef.current = "";
            }}
            className="rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Clear all
          </button>
        </div>

        {/* Upload zone for adding more games */}
        {uploadZone}
      </div>
    );
  }

  return <div className="mt-4">{uploadZone}</div>;
}

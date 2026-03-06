"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CountryFlag } from "@/components/country-flag";

interface FideSuggestion {
  slug: string;
  name: string;
  title: string | null;
  fideRating: number;
  federation: string | null;
}

interface LichessSuggestion {
  id: string;
  name: string;
  title?: string;
  online?: boolean;
}

type Platform = "fide" | "lichess" | "chesscom";

const PLATFORMS: { key: Platform; label: string }[] = [
  { key: "fide", label: "FIDE" },
  { key: "lichess", label: "Lichess" },
  { key: "chesscom", label: "Chess.com" },
];

function formatPlayerName(name: string): string {
  if (name.includes(",") && !name.includes(", ")) {
    return name.replace(",", ", ");
  }
  return name;
}

export default function SearchInput() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [platform, setPlatform] = useState<Platform>("fide");
  const router = useRouter();

  // Autocomplete state (used by fide and lichess only)
  const [fideSuggestions, setFideSuggestions] = useState<FideSuggestion[]>([]);
  const [lichessSuggestions, setLichessSuggestions] = useState<LichessSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const suggestions = platform === "fide" ? fideSuggestions : lichessSuggestions;
  const hasSuggestions = suggestions.length > 0;
  const hasAutocomplete = platform === "fide" || platform === "lichess";

  // Click-outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // Clear results when switching platforms
  function handlePlatformChange(p: Platform) {
    setPlatform(p);
    setError("");
    setFideSuggestions([]);
    setLichessSuggestions([]);
    setShowDropdown(false);
    setSelectedIndex(-1);
  }

  function handleInputChange(value: string) {
    setUsername(value);
    setError("");
    setSelectedIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!hasAutocomplete || value.trim().length < 2) {
      setFideSuggestions([]);
      setLichessSuggestions([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (platform === "fide") {
          const res = await fetch(
            `/api/players/search?q=${encodeURIComponent(value.trim())}`,
            { signal: controller.signal },
          );
          if (res.ok) {
            const data = await res.json();
            setFideSuggestions(data);
            setShowDropdown(data.length > 0);
          }
        } else if (platform === "lichess") {
          const res = await fetch(
            `/api/lichess/autocomplete?term=${encodeURIComponent(value.trim())}`,
            { signal: controller.signal },
          );
          if (res.ok) {
            const data = await res.json();
            setLichessSuggestions(data);
            setShowDropdown(data.length > 0);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }, 250);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || !hasSuggestions) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1,
        );
        break;
      case "Enter":
        if (selectedIndex >= 0) {
          e.preventDefault();
          handleSelect(selectedIndex);
        }
        break;
      case "Escape":
        setShowDropdown(false);
        setSelectedIndex(-1);
        break;
    }
  }

  function handleSelect(index: number) {
    setShowDropdown(false);

    if (platform === "fide") {
      const player = fideSuggestions[index];
      if (player) {
        setFideSuggestions([]);
        router.push(`/player/${player.slug}`);
      }
    } else if (platform === "lichess") {
      const user = lichessSuggestions[index];
      if (user) {
        setLichessSuggestions([]);
        router.push(`/player/lichess:${user.id}`);
      }
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;

    setShowDropdown(false);
    setLoading(true);
    setError("");

    try {
      if (platform === "chesscom") {
        const res = await fetch(
          `https://api.chess.com/pub/player/${trimmed.toLowerCase()}`,
        );
        if (res.status === 404) {
          setError(`Player "${trimmed}" not found on Chess.com`);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          setError("Something went wrong. Please try again.");
          setLoading(false);
          return;
        }
        router.push(`/player/chesscom:${trimmed}`);
      } else if (platform === "lichess") {
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
        router.push(`/player/lichess:${trimmed}`);
      } else {
        // FIDE: shouldn't normally submit without selecting from dropdown,
        // but handle gracefully by searching and navigating to first result
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) {
            router.push(`/player/${data[0].slug}`);
            return;
          }
        }
        setError(`No FIDE player found for "${trimmed}". Try a different spelling.`);
        setLoading(false);
      }
    } catch {
      setError("Network error. Please check your connection.");
      setLoading(false);
    }
  }

  const placeholderText =
    platform === "chesscom"
      ? "Enter exact Chess.com username..."
      : platform === "lichess"
        ? "Search Lichess username..."
        : "Search FIDE player name or ID...";

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md" autoComplete="off">
      {/* Platform tabs */}
      <div className="flex gap-1 mb-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => handlePlatformChange(p.key)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              platform === p.key
                ? "bg-zinc-700 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div ref={wrapperRef} className="relative">
        <input
          role={hasAutocomplete ? "combobox" : undefined}
          aria-expanded={hasAutocomplete ? showDropdown : undefined}
          aria-autocomplete={hasAutocomplete ? "list" : undefined}
          aria-controls={hasAutocomplete ? "player-search-listbox" : undefined}
          aria-activedescendant={
            selectedIndex >= 0 ? `player-option-${selectedIndex}` : undefined
          }
          type="search"
          value={username}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (hasSuggestions) setShowDropdown(true);
          }}
          placeholder={placeholderText}
          name="player-search"
          autoComplete="one-time-code"
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
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
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

        {/* Autocomplete dropdown (FIDE and Lichess only) */}
        {showDropdown && hasSuggestions && (
          <ul
            id="player-search-listbox"
            role="listbox"
            className={`absolute top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl ${
              platform === "lichess"
                ? "left-0 w-fit min-w-[200px]"
                : "left-0 right-0"
            }`}
          >
            {platform === "fide" &&
              fideSuggestions.map((player, index) => (
                <li
                  key={player.slug}
                  id={`player-option-${index}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(index); }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    index === selectedIndex ? "bg-zinc-700/50" : "hover:bg-zinc-700/30"
                  }`}
                >
                  <span className="text-xs font-bold text-amber-400 w-7 shrink-0 text-center">
                    {player.title || ""}
                  </span>
                  <span className="flex-1 text-sm text-white truncate">
                    {formatPlayerName(player.name)}
                  </span>
                  {player.federation && (
                    <CountryFlag federation={player.federation} className="text-sm shrink-0" />
                  )}
                  <span className="text-sm font-mono text-green-400 tabular-nums shrink-0">
                    {player.fideRating}
                  </span>
                </li>
              ))}

            {platform === "lichess" &&
              lichessSuggestions.map((user, index) => (
                <li
                  key={user.id}
                  id={`player-option-${index}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(index); }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors whitespace-nowrap ${
                    index === selectedIndex ? "bg-zinc-700/50" : "hover:bg-zinc-700/30"
                  }`}
                >
                  {user.title && (
                    <span className="text-xs font-bold text-amber-400 shrink-0">
                      {user.title}
                    </span>
                  )}
                  <span className="text-sm text-white">
                    {user.name}
                  </span>
                  {user.online && (
                    <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Online now" />
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-400">{error}</p>
      )}
    </form>
  );
}

"use client";

import { useEffect } from "react";

/**
 * Registers the Stockfish Service Worker for persistent WASM caching,
 * and eagerly fetches stockfish assets into the browser cache as a fallback.
 * Runs once and persists across client-side navigations since the root
 * layout never unmounts.
 */
export function StockfishPreloader() {
  useEffect(() => {
    // Register Service Worker — it pre-caches stockfish assets on install
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // Fallback: eagerly fetch into browser HTTP cache (covers browsers
    // where SW registration fails or hasn't activated yet)
    const id = setTimeout(() => {
      fetch("/stockfish.js").catch(() => {});
      fetch("/stockfish.wasm").catch(() => {});
    }, 1000);
    return () => clearTimeout(id);
  }, []);

  return null;
}

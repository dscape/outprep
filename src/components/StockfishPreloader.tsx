"use client";

import { useEffect } from "react";

/**
 * Eagerly fetches Stockfish WASM assets into the browser HTTP cache.
 * Runs once and persists across client-side navigations since the root
 * layout never unmounts.
 *
 * Previously used a Service Worker for caching, but the SW's fetch
 * interception caused navigation failures on mobile Safari.
 */
export function StockfishPreloader() {
  useEffect(() => {
    // Unregister any previously-installed service worker. The updated
    // sw.js self-unregisters on activate, but this handles the case
    // where the browser never re-fetches the SW script.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
    }

    // Eagerly fetch stockfish assets into the browser HTTP cache
    const id = setTimeout(() => {
      fetch("/stockfish.js").catch(() => {});
      fetch("/stockfish.wasm").catch(() => {});
    }, 1000);
    return () => clearTimeout(id);
  }, []);

  return null;
}

"use client";

import { useEffect } from "react";

/**
 * Eagerly fetches stockfish.js and stockfish.wasm into the browser cache
 * as soon as the app loads. Uses fetch() so the downloads actually happen
 * (unlike <link rel="prefetch"> which browsers can ignore). Runs once and
 * persists across client-side navigations since the root layout never unmounts.
 */
export function StockfishPreloader() {
  useEffect(() => {
    // Small delay so we don't compete with critical page resources
    const id = setTimeout(() => {
      fetch("/stockfish.js").catch(() => {});
      fetch("/stockfish.wasm").catch(() => {});
    }, 1000);
    return () => clearTimeout(id);
  }, []);

  return null;
}

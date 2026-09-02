"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const SESSION_VISITED_KEY = "outprep:visited";
const STOCKFISH_ASSETS = ["/stockfish.js", "/stockfish.wasm"];

let preloadStarted = false;

/**
 * Preloads Stockfish only after a browser has navigated within outprep and
 * passed BotID. One-off crawlers never trigger the 113 MB download, while
 * people browsing the site still have the engine ready before they need it.
 */
export function StockfishPreloader() {
  const pathname = usePathname();

  useEffect(() => {
    unregisterLegacyServiceWorkers();
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    try {
      const hasVisited = sessionStorage.getItem(SESSION_VISITED_KEY) === "true";
      sessionStorage.setItem(SESSION_VISITED_KEY, "true");
      if (hasVisited) void preloadStockfish();
    } catch {
      // Storage can be unavailable in privacy modes. Stockfish still loads on demand.
    }
  }, [pathname]);

  return null;
}

function unregisterLegacyServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => registrations.forEach((registration) => registration.unregister()))
    .catch(() => {});
}

async function preloadStockfish() {
  if (preloadStarted) return;
  preloadStarted = true;

  try {
    const access = await fetch("/api/engine-access", {
      method: "POST",
      cache: "no-store",
    });
    if (!access.ok) return;

    for (const asset of STOCKFISH_ASSETS) {
      void fetch(asset, { cache: "force-cache" }).catch(() => {});
    }
  } catch {
    // Preloading is optional; the engine remains available on demand.
  }
}

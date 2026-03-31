// Service Worker for caching Stockfish WASM assets.
// Bump CACHE_VERSION when stockfish is upgraded to force re-download.
const CACHE_VERSION = "stockfish-v18";
const STOCKFISH_ASSETS = ["/stockfish.js", "/stockfish.wasm"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STOCKFISH_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Clean up old versioned caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("stockfish-") && key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Don't call clients.claim() — let the SW take control naturally on next
  // page load. Claiming mid-session causes navigation failures on mobile Safari.
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (!STOCKFISH_ASSETS.includes(url.pathname)) {
    // Mobile Safari can fail navigations when respondWith() is not called
    // by an active service worker. Explicitly pass through navigation
    // requests so the browser always gets a proper response.
    if (event.request.mode === "navigate") {
      event.respondWith(fetch(event.request));
    }
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

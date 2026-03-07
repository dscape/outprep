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
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only intercept stockfish asset requests
  if (!STOCKFISH_ASSETS.includes(url.pathname)) return;

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

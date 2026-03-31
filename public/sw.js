// This service worker unregisters itself on activation.
// Previously used for caching Stockfish WASM assets, but the fetch
// interception caused navigation failures on mobile Safari. Stockfish
// assets are now cached via the browser HTTP cache (StockfishPreloader).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.registration.unregister());

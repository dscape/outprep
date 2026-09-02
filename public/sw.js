// This service worker unregisters itself on activation.
// Stockfish caching no longer uses a service worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.registration.unregister());

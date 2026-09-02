// This service worker unregisters itself on activation.
// Stockfish now loads on demand without a service worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.registration.unregister());

"use client";

import { useEffect } from "react";

/**
 * Catches ChunkLoadError (caused by content blockers preventing JS chunks
 * from loading during client-side navigation) and falls back to a full
 * page reload. Full page loads serve pre-rendered HTML and aren't affected
 * by content blockers blocking dynamically-inserted scripts.
 *
 * Mounted once in the root layout.
 */
export function ChunkErrorHandler() {
  useEffect(() => {
    function handleChunkError() {
      // Prevent infinite reload loops: at most one reload per 10 seconds
      const key = "__chunk_reload";
      const last = parseInt(sessionStorage.getItem(key) || "0");
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
      }
    }

    const onError = (event: ErrorEvent) => {
      if (event.error?.name === "ChunkLoadError") {
        event.preventDefault();
        handleChunkError();
      }
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      if (event.reason?.name === "ChunkLoadError") {
        event.preventDefault();
        handleChunkError();
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}

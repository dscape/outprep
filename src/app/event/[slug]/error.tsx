"use client";

export default function EventError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError = error.name === "ChunkLoadError";

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-xl font-bold text-white">
          {isChunkError ? "Loading failed" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-sm text-zinc-400 max-w-sm">
          {isChunkError
            ? "A content blocker may be preventing the page from loading. Try reloading or disabling your content blocker for this site."
            : "An unexpected error occurred."}
        </p>
        <div className="mt-6 flex gap-3 justify-center">
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-zinc-700 px-4 py-2 text-sm text-white hover:bg-zinc-600 transition-colors"
          >
            Reload page
          </button>
          <button
            onClick={() => window.history.back()}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}

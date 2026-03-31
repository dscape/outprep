export default function EventLoading() {
  return (
    <div className="min-h-screen px-4 py-8 animate-pulse">
      <div className="mx-auto max-w-4xl">
        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2">
          <div className="h-4 w-10 rounded bg-zinc-800" />
          <span className="text-zinc-700">/</span>
          <div className="h-4 w-48 rounded bg-zinc-800" />
        </div>

        {/* Header card */}
        <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
          <div className="h-7 w-72 rounded bg-zinc-700/50" />
          <div className="mt-3 flex gap-3">
            <div className="h-4 w-32 rounded bg-zinc-700/30" />
            <div className="h-4 w-40 rounded bg-zinc-700/30" />
          </div>
          <div className="mt-4 flex gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg bg-zinc-900/50 px-4 py-2 w-20 h-14" />
            ))}
          </div>
        </div>

        {/* Games list */}
        <div className="mt-8">
          <div className="h-5 w-16 rounded bg-zinc-800 mb-4" />
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-4 py-3"
              >
                <div className="h-4 w-6 rounded bg-zinc-800/50" />
                <div className="h-4 w-36 rounded bg-zinc-800/50" />
                <div className="h-4 w-10 rounded bg-zinc-800/50" />
                <div className="h-4 w-36 rounded bg-zinc-800/50" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

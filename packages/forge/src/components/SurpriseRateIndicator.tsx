"use client";

function rateColor(rate: number): string {
  if (rate > 0.3) return "text-emerald-400";
  if (rate >= 0.1) return "text-amber-400";
  return "text-red-400";
}

function rateBg(rate: number): string {
  if (rate > 0.3) return "bg-emerald-900/50 border-emerald-800";
  if (rate >= 0.1) return "bg-amber-900/50 border-amber-800";
  return "bg-red-900/50 border-red-800";
}

export function SurpriseRateIndicator({
  rate,
  totalEntries,
  healthy,
  message,
}: {
  rate: number;
  totalEntries: number;
  healthy: boolean;
  message: string;
}) {
  const percentage = (rate * 100).toFixed(0);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${rateBg(rate)}`}
      title={message}
    >
      <span className={rateColor(rate)}>{percentage}%</span>
      <span className="text-zinc-500">
        ({totalEntries} {totalEntries === 1 ? "entry" : "entries"})
      </span>
      {healthy ? (
        <span className="text-emerald-500">healthy</span>
      ) : (
        <span className="text-red-500">low</span>
      )}
    </span>
  );
}

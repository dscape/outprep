"use client";

import { useScout } from "./scout-context";
import { TIME_RANGES } from "@/lib/profile-merge";

export default function TimeRangeFilter() {
  const { profile, timeRange, setTimeRange, timeRangeLoading } = useScout();

  if (!profile) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-500 uppercase tracking-wide mr-1">
        Period
      </span>
      {TIME_RANGES.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => {
            if (key !== timeRange) setTimeRange(key);
          }}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            timeRange === key
              ? "bg-green-600 text-white"
              : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {label}
          {timeRangeLoading && timeRange === key && (
            <span className="ml-1.5 inline-block h-3 w-3 rounded-full border-2 border-green-200 border-t-transparent animate-spin align-middle" />
          )}
        </button>
      ))}
    </div>
  );
}

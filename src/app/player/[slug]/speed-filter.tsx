"use client";

import { useState, useEffect } from "react";
import { useScout } from "./scout-context";

export default function SpeedFilter() {
  const { profile, availableSpeeds, selectedSpeeds, toggleSpeed } = useScout();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !profile || availableSpeeds.length < 1) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-500 uppercase tracking-wide mr-1">
        Speed
      </span>
      {availableSpeeds.map((speed) => {
        const data = profile.bySpeed?.[speed];
        const isActive = selectedSpeeds.includes(speed);
        return (
          <button
            key={speed}
            onClick={() => toggleSpeed(speed)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-green-600 text-white"
                : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {speed.charAt(0).toUpperCase() + speed.slice(1)}{" "}
            <span className={isActive ? "text-green-200" : "text-zinc-600"}>
              {data?.games}
            </span>
          </button>
        );
      })}
    </div>
  );
}

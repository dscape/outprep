"use client";

import { useEffect, useState } from "react";

const stages = [
  "Fetching game archive...",
  "Analyzing opening repertoire...",
  "Detecting tactical patterns...",
  "Mapping positional tendencies...",
  "Identifying weaknesses...",
  "Generating practice bot...",
];

export default function LoadingStages() {
  const [currentStage, setCurrentStage] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStage((prev) => {
        if (prev < stages.length - 1) return prev + 1;
        return prev;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <div className="h-12 w-12 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
        </div>

        <div className="space-y-3">
          {stages.map((stage, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 transition-all duration-500 ${
                i < currentStage
                  ? "opacity-50"
                  : i === currentStage
                    ? "opacity-100"
                    : "opacity-20"
              }`}
            >
              {i < currentStage ? (
                <svg
                  className="h-5 w-5 shrink-0 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : i === currentStage ? (
                <div className="h-5 w-5 shrink-0 flex items-center justify-center">
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                </div>
              ) : (
                <div className="h-5 w-5 shrink-0 flex items-center justify-center">
                  <div className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                </div>
              )}
              <span
                className={`text-sm ${
                  i === currentStage ? "text-white font-medium" : "text-zinc-400"
                }`}
              >
                {stage}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { PrepTip } from "@/lib/types";
import { getLichessTrainingUrl } from "@/lib/lichess-training";

interface PrepTipsTabProps {
  tips: PrepTip[];
}

export default function PrepTipsTab({ tips }: PrepTipsTabProps) {
  if (tips.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        Not enough data to generate preparation tips.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {tips.map((tip, i) => (
        <div
          key={i}
          className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-4"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-600/20 text-xs font-bold text-green-400">
              {i + 1}
            </div>
            <div>
              <h4 className="font-medium text-white">{tip.title}</h4>
              <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
                {tip.description}
              </p>
              {tip.openingName && (() => {
                const url = getLichessTrainingUrl(tip.openingName!);
                return url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-green-400 transition-colors"
                  >
                    Practice puzzles on lichess.org
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3.5 3.5h5v5" />
                      <path d="M8.5 3.5L3 9" />
                    </svg>
                  </a>
                ) : null;
              })()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

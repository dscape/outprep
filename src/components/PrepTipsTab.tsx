"use client";

import { PrepTip } from "@/lib/types";

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
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

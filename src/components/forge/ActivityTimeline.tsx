"use client";

import type { ActivityEvent } from "@/lib/forge-types";

const typeConfig: Record<
  ActivityEvent["type"],
  { color: string; bg: string; label: string }
> = {
  experiment: { color: "text-blue-400", bg: "bg-blue-400", label: "Experiment" },
  oracle: { color: "text-purple-400", bg: "bg-purple-400", label: "Oracle" },
  "code-change": { color: "text-emerald-400", bg: "bg-emerald-400", label: "Code Change" },
  note: { color: "text-amber-400", bg: "bg-amber-400", label: "Note" },
  "knowledge-update": { color: "text-cyan-400", bg: "bg-cyan-400", label: "Knowledge" },
  "session-status": { color: "text-zinc-400", bg: "bg-zinc-400", label: "Status" },
  hypothesis: { color: "text-yellow-400", bg: "bg-yellow-400", label: "Hypothesis" },
  "kill-signal": { color: "text-red-400", bg: "bg-red-400", label: "Kill Signal" },
  reflection: { color: "text-teal-400", bg: "bg-teal-400", label: "Reflection" },
};

export function ActivityTimeline({
  events,
  onNavigate,
  onSeeInConsole,
}: {
  events: ActivityEvent[];
  onNavigate: (tab: string, artifactId?: string) => void;
  onSeeInConsole: (ts?: string) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="relative pl-6">
      {/* Vertical line */}
      <div className="absolute left-2 top-2 bottom-2 w-px bg-zinc-800" />

      <div className="space-y-4">
        {events.map((event) => {
          const config = typeConfig[event.type];

          return (
            <div key={event.id} className="relative">
              {/* Dot */}
              <div
                className={`absolute -left-4 top-2 w-2.5 h-2.5 rounded-full ${config.bg}`}
              />

              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs font-medium ${config.color}`}
                      >
                        {config.label}
                      </span>
                      <span className="text-xs text-zinc-600">
                        {new Date(event.timestamp).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-200 break-words">
                      {event.title}
                    </p>
                    {event.detail && (
                      <p className="text-xs text-zinc-500 mt-1">
                        {event.detail}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {event.artifactType && (
                      <button
                        onClick={() => onNavigate(event.artifactType!)}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        View
                      </button>
                    )}
                    {event.consoleTimestamp && (
                      <button
                        onClick={() => onSeeInConsole(event.consoleTimestamp)}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        See in console
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { FeatureRequest } from "@/lib/forge-types";

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    repl: "bg-blue-900/50 text-blue-400 border-blue-800/50",
    forge: "bg-purple-900/50 text-purple-400 border-purple-800/50",
    harness: "bg-amber-900/50 text-amber-400 border-amber-800/50",
    engine: "bg-emerald-900/50 text-emerald-400 border-emerald-800/50",
    other: "bg-zinc-800 text-zinc-400 border-zinc-700/50",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${colors[category] ?? colors.other}`}>
      {category}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-yellow-900/50 text-yellow-400 border-yellow-800/50",
    accepted: "bg-emerald-900/50 text-emerald-400 border-emerald-800/50",
    rejected: "bg-red-900/50 text-red-400 border-red-800/50",
    implemented: "bg-blue-900/50 text-blue-400 border-blue-800/50",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${colors[status] ?? colors.open}`}>
      {status}
    </span>
  );
}

export function FeatureRequestCard({ request }: { request: FeatureRequest }) {
  const [responding, setResponding] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [currentStatus, setCurrentStatus] = useState(request.status);

  const timestamp = new Date(request.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  async function handleReview(status: string) {
    try {
      await fetch(`/api/forge/requests/${request.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, response: responseText || undefined }),
      });
      setCurrentStatus(status as FeatureRequest["status"]);
      setResponding(false);
    } catch (err) {
      console.error("Failed to review request:", err);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{request.title}</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            by {request.agentName} &middot; {timestamp}
          </p>
        </div>
        <div className="flex gap-2">
          <CategoryBadge category={request.category} />
          <StatusBadge status={currentStatus} />
        </div>
      </div>

      <p className="text-sm text-zinc-300 mt-3">{request.description}</p>

      {request.response && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <p className="text-xs text-zinc-500 mb-1">Response:</p>
          <p className="text-sm text-zinc-300">{request.response}</p>
        </div>
      )}

      {currentStatus === "open" && (
        <div className="mt-4 pt-3 border-t border-zinc-800">
          {responding ? (
            <div className="space-y-2">
              <textarea
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                placeholder="Optional response..."
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleReview("accepted")}
                  className="rounded bg-emerald-800 px-3 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-700"
                >
                  Accept
                </button>
                <button
                  onClick={() => handleReview("rejected")}
                  className="rounded bg-red-800 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-700"
                >
                  Reject
                </button>
                <button
                  onClick={() => setResponding(false)}
                  className="rounded bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-400 hover:bg-zinc-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setResponding(true)}
              className="rounded bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
            >
              Review
            </button>
          )}
        </div>
      )}
    </div>
  );
}

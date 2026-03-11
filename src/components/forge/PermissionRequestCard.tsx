"use client";

import { useState } from "react";

interface PermissionRequest {
  id: string;
  session_id: string;
  agent_id: string | null;
  requested_at: string;
  permission_type: string | null;
  details: string | null;
  status: string;
  responded_at: string | null;
  response_by: string | null;
}

export function PermissionRequestCard({ request }: { request: PermissionRequest }) {
  const [status, setStatus] = useState(request.status);
  const [loading, setLoading] = useState(false);

  async function handleAction(action: "approve" | "reject") {
    setLoading(true);
    try {
      const res = await fetch(`/api/forge/permissions/${request.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setStatus(action === "approve" ? "approved" : "rejected");
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  const details = request.details ? JSON.parse(request.details) : null;
  const time = new Date(request.requested_at).toLocaleString();

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-zinc-100">
              {request.permission_type ?? "Permission"} Request
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              status === "pending"
                ? "bg-amber-900/40 text-amber-400"
                : status === "approved"
                ? "bg-emerald-900/40 text-emerald-400"
                : "bg-red-900/40 text-red-400"
            }`}>
              {status}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Session: {request.session_id.slice(0, 8)}
            {request.agent_id ? ` · Agent: ${request.agent_id.slice(0, 8)}` : ""}
            {" · "}{time}
          </p>
          {details && (
            <pre className="mt-2 text-xs text-zinc-400 bg-zinc-800/50 rounded p-2 overflow-x-auto">
              {JSON.stringify(details, null, 2)}
            </pre>
          )}
        </div>

        {status === "pending" && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => handleAction("approve")}
              disabled={loading}
              className="rounded bg-emerald-800 px-3 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-700 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => handleAction("reject")}
              disabled={loading}
              className="rounded bg-red-900 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-800 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

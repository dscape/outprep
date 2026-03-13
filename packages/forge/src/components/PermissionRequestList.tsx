"use client";

import { useEffect, useState } from "react";
import { PermissionRequestCard } from "./PermissionRequestCard";

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

export function PermissionRequestList() {
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  useEffect(() => {
    setLoading(true);
    const url = filter === "pending"
      ? "/api/permissions?status=pending"
      : "/api/permissions?status=all";
    fetch(url)
      .then((r) => r.json())
      .then((data) => setRequests(Array.isArray(data) ? data : []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">Permission Requests</h3>
        <div className="flex gap-1 rounded bg-zinc-800 p-0.5">
          <button
            onClick={() => setFilter("pending")}
            className={`rounded px-2 py-1 text-[10px] font-medium ${
              filter === "pending" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500"
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`rounded px-2 py-1 text-[10px] font-medium ${
              filter === "all" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500"
            }`}
          >
            All
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-zinc-600">Loading...</p>
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center">
          <p className="text-xs text-zinc-500">
            {filter === "pending"
              ? "No pending permission requests."
              : "No permission requests yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <PermissionRequestCard key={req.id} request={req} />
          ))}
        </div>
      )}
    </div>
  );
}

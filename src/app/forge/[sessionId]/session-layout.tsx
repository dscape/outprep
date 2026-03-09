"use client";

import { useState } from "react";
import type { ForgeSession, ActivityEvent } from "@/lib/forge-types";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { SessionControls } from "@/components/forge/SessionControls";
import { SessionTabs, type Tab } from "./session-tabs";

export function SessionLayout({
  session,
  logs,
  activity,
  isDev,
  created,
}: {
  session: Omit<ForgeSession, "conversationHistory">;
  logs: { filename: string; content: string }[];
  activity: ActivityEvent[];
  isDev: boolean;
  created: string;
}) {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-xl font-semibold text-zinc-100">
            {session.name}
          </h2>
          <StatusBadge status={session.status} />
          <SessionControls
            sessionId={session.id}
            status={session.status}
            onTabChange={(t) => setTab(t as Tab)}
          />
        </div>
        <p className="text-sm text-zinc-500">
          {session.players.join(", ")} &middot; {session.focus} &middot;
          Created {created}
        </p>
      </div>

      <SessionTabs
        session={session}
        logs={logs}
        activity={activity}
        isDev={isDev}
        tab={tab}
        onTabChange={setTab}
      />
    </div>
  );
}

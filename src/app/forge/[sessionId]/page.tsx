import { notFound } from "next/navigation";
import { getSession, getSessionLogs, buildActivityLog } from "@/lib/forge";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { SessionControls } from "@/components/forge/SessionControls";
import { SessionTabs } from "./session-tabs";

export const revalidate = 0;

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = getSession(sessionId);
  if (!session) notFound();

  const logs = getSessionLogs(session.name);
  const activity = buildActivityLog(session);

  const created = new Date(session.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-xl font-semibold text-zinc-100">
            {session.name}
          </h2>
          <StatusBadge status={session.status} />
          <SessionControls sessionId={session.id} status={session.status} />
        </div>
        <p className="text-sm text-zinc-500">
          {session.players.join(", ")} &middot; {session.focus} &middot;
          Created {created}
        </p>
      </div>

      <SessionTabs session={session} logs={logs} activity={activity} isDev={process.env.NODE_ENV === "development"} />
    </div>
  );
}

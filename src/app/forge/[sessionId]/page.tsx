import { notFound } from "next/navigation";
import { getSession, getSessionLogs, buildActivityLog } from "@/lib/forge";
import { SessionLayout } from "./session-layout";

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
    <SessionLayout
      session={session}
      logs={logs}
      activity={activity}
      isDev={process.env.NODE_ENV === "development"}
      created={created}
    />
  );
}

import { notFound } from "next/navigation";
import { getAgent } from "@/lib/forge";
import { AgentDetailView } from "./agent-detail";

export const revalidate = 0;

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const agent = getAgent(agentId);
  if (!agent) notFound();

  return <AgentDetailView agent={agent} />;
}

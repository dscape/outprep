import { NextResponse } from "next/server";
import { stopAgentProcess } from "@/lib/forge-process";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const stopped = stopAgentProcess(agentId);
  if (!stopped) {
    return NextResponse.json(
      { error: "Agent not running or not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ stopped: true });
}

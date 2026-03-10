import { NextResponse } from "next/server";
import { startSingleAgent } from "@/lib/forge-process";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const result = startSingleAgent(agentId);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ started: true });
}

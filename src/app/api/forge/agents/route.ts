import { NextResponse } from "next/server";
import { getAgentSummaries } from "@/lib/forge";
import { startAgentProcess } from "@/lib/forge-process";

export async function GET() {
  return NextResponse.json(getAgentSummaries());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { players, focus, maxExperiments, seed, quick } = body;

    const result = startAgentProcess({
      players: Array.isArray(players) && players.length > 0 ? players : undefined,
      focus: focus || undefined,
      maxExperiments,
      seed,
      quick,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ agentId: result.agentId, status: "starting" });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

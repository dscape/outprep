import { NextRequest, NextResponse } from "next/server";
import { startSession, getProcessError } from "@/lib/forge-process";
import { getSessionSummaries } from "@/lib/forge";

export async function GET(request: NextRequest) {
  const tempId = request.nextUrl.searchParams.get("checkError");
  if (tempId) {
    const err = getProcessError(tempId);
    if (err) {
      return NextResponse.json({ error: err.error || `Process exited with code ${err.exitCode}` }, { status: 500 });
    }
    return NextResponse.json({ status: "running" });
  }

  return NextResponse.json(getSessionSummaries());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, players, focus, maxExperiments, seed, quick } = body;

    if (!players || !Array.isArray(players) || players.length === 0) {
      return NextResponse.json(
        { error: "players is required (array of usernames)" },
        { status: 400 }
      );
    }

    const result = startSession({
      name,
      players,
      focus,
      maxExperiments,
      seed,
      quick,
    });

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ sessionId: result.sessionId, status: "starting" });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

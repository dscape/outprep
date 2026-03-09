import { NextResponse } from "next/server";
import { startSession } from "@/lib/forge-process";

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

    return NextResponse.json({ sessionId: result.sessionId, status: "starting" });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { resumeSession } from "@/lib/forge-process";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  const started = resumeSession(sessionId);
  if (!started) {
    return NextResponse.json(
      { error: "Session is already running" },
      { status: 409 }
    );
  }

  return NextResponse.json({ sessionId, status: "resuming" });
}

import { NextResponse } from "next/server";
import { stopSession } from "@/lib/forge-process";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  const stopped = stopSession(sessionId);
  if (!stopped) {
    return NextResponse.json(
      { error: "Session is not running" },
      { status: 404 }
    );
  }

  return NextResponse.json({ sessionId, status: "stopping" });
}

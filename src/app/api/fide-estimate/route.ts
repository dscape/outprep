import { NextRequest, NextResponse } from "next/server";
import { fetchLichessUser } from "@/lib/lichess";
import { estimateFIDE } from "@/lib/fide-estimator";

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username");

  if (!username) {
    return NextResponse.json({ error: "username parameter is required" }, { status: 400 });
  }

  try {
    const user = await fetchLichessUser(username);
    const estimate = estimateFIDE(user);
    return NextResponse.json(estimate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

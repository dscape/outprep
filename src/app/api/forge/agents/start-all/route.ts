import { NextResponse } from "next/server";
import { startAllAgents } from "@/lib/forge-process";

export async function POST() {
  const result = startAllAgents();
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ started: result.started });
}

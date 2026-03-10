import { NextResponse } from "next/server";
import { stopAllAgents } from "@/lib/forge-process";

export async function POST() {
  const stopped = stopAllAgents();
  return NextResponse.json({ stopped });
}

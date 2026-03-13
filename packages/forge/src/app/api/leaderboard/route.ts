import { NextResponse } from "next/server";
import { getLeaderboard } from "@/lib/forge";

export async function GET() {
  return NextResponse.json(getLeaderboard());
}

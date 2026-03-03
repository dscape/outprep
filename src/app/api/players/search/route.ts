import { NextRequest, NextResponse } from "next/server";
import { searchPlayers } from "@/lib/db";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");

  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  try {
    const results = await searchPlayers(q, 8);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json([]);
  }
}

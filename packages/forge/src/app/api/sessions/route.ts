import { NextResponse } from "next/server";
import { getSessionSummaries } from "@/lib/forge";

export async function GET() {
  return NextResponse.json(getSessionSummaries());
}

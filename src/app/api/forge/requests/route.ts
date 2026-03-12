import { NextRequest, NextResponse } from "next/server";
import { getFeatureRequests } from "@/lib/forge";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const agentId = request.nextUrl.searchParams.get("agentId") ?? undefined;
  return NextResponse.json(getFeatureRequests({ status, agentId }));
}

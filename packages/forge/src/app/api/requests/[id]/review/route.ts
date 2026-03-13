import { NextResponse } from "next/server";
import { updateFeatureRequestStatus } from "@/lib/forge";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { status, response } = body;

  if (!status || !["accepted", "rejected", "implemented"].includes(status)) {
    return NextResponse.json(
      { error: "status must be 'accepted', 'rejected', or 'implemented'" },
      { status: 400 },
    );
  }

  const updated = updateFeatureRequestStatus(id, status, response);
  if (!updated) {
    return NextResponse.json(
      { error: "Feature request not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ updated: true });
}

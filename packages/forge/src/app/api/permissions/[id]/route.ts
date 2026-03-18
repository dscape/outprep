import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { action } = body; // "approve" or "reject"

  try {
    const Database = require("better-sqlite3");
    const path = require("path");
    const fs = require("fs");
    const FORGE_ROOT = process.env.FORGE_DATA_DIR || process.cwd();
    const DB_PATH = path.join(FORGE_ROOT, "forge.db");

    if (!fs.existsSync(DB_PATH)) {
      return NextResponse.json({ success: false, error: "Database not found" }, { status: 404 });
    }

    const db = new Database(DB_PATH);

    const result = db
      .prepare(
        `UPDATE permission_requests SET status = ?, responded_at = ?, response_by = 'admin'
         WHERE id = ? AND status = 'pending'`,
      )
      .run(
        action === "approve" ? "approved" : "rejected",
        new Date().toISOString(),
        id,
      );

    db.close();
    return NextResponse.json({ success: result.changes > 0 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") ?? "pending";
  const agentId = request.nextUrl.searchParams.get("agentId") ?? undefined;

  try {
    const Database = require("better-sqlite3");
    const path = require("path");
    const fs = require("fs");
    const FORGE_ROOT = process.env.FORGE_DATA_DIR || process.cwd();
    const DB_PATH = path.join(FORGE_ROOT, "forge.db");

    if (!fs.existsSync(DB_PATH)) {
      return NextResponse.json([]);
    }

    const db = new Database(DB_PATH, { readonly: true });

    let rows;
    if (status === "all") {
      if (agentId) {
        rows = db
          .prepare(
            `SELECT * FROM permission_requests WHERE agent_id = ? ORDER BY requested_at DESC`,
          )
          .all(agentId);
      } else {
        rows = db
          .prepare(
            `SELECT * FROM permission_requests ORDER BY requested_at DESC`,
          )
          .all();
      }
    } else if (agentId) {
      rows = db
        .prepare(
          `SELECT * FROM permission_requests WHERE status = ? AND agent_id = ? ORDER BY requested_at DESC`,
        )
        .all(status, agentId);
    } else {
      rows = db
        .prepare(
          `SELECT * FROM permission_requests WHERE status = ? ORDER BY requested_at DESC`,
        )
        .all(status);
    }

    db.close();
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json([]);
  }
}

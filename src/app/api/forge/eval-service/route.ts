import { NextRequest, NextResponse } from "next/server";
import {
  isEvalServiceRunning,
  startEvalServiceProcess,
  stopEvalServiceProcess,
} from "@/lib/forge-process";

function getServiceStatus(): { running: boolean; recentlyActive: boolean } {
  const pidRunning = isEvalServiceRunning();

  // Also check if any tool_jobs are in 'running' status (means eval service is actively processing)
  let recentlyActive = false;
  try {
    const Database = require("better-sqlite3");
    const path = require("path");
    const fs = require("fs");
    const FORGE_ROOT =
      process.env.FORGE_DATA_DIR || path.join(process.cwd(), "packages", "forge");
    const DB_PATH = path.join(FORGE_ROOT, "forge.db");
    if (fs.existsSync(DB_PATH)) {
      const db = new Database(DB_PATH, { readonly: true });
      const running = db
        .prepare(`SELECT COUNT(*) as c FROM tool_jobs WHERE status = 'running'`)
        .get() as any;
      // Check if any job was completed in the last 60 seconds
      const recent = db
        .prepare(
          `SELECT COUNT(*) as c FROM tool_jobs WHERE status IN ('completed', 'failed') AND completed_at > datetime('now', '-60 seconds')`,
        )
        .get() as any;
      db.close();
      recentlyActive = (running?.c ?? 0) > 0 || (recent?.c ?? 0) > 0;
    }
  } catch {}

  return { running: pidRunning || recentlyActive, recentlyActive };
}

export async function GET() {
  return NextResponse.json(getServiceStatus());
}

export async function POST(request: NextRequest) {
  const { action } = await request.json();

  if (action === "start") {
    const result = startEvalServiceProcess();
    return NextResponse.json({ ...result, ...getServiceStatus() });
  }

  if (action === "stop") {
    const stopped = stopEvalServiceProcess();
    return NextResponse.json({ stopped, ...getServiceStatus() });
  }

  return NextResponse.json({ error: "Invalid action. Use 'start' or 'stop'." }, { status: 400 });
}

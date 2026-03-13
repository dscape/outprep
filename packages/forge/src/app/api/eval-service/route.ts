import { NextRequest, NextResponse } from "next/server";
import {
  isEvalServiceRunning,
  startEvalServiceProcess,
  stopEvalServiceProcess,
} from "@/lib/forge-process";

interface ServiceStatus {
  running: boolean;
  recentlyActive: boolean;
  pid: number | null;
  pidAlive: boolean;
  activeJobId: string | null;
  activeJobProgress: Record<string, unknown> | null;
  queueDepth: number;
  lastCompletedAt: string | null;
  lastError: string | null;
}

function readEvalPid(): { pid: number | null; alive: boolean } {
  const fs = require("fs");
  const path = require("path");
  const FORGE_ROOT =
    process.env.FORGE_DATA_DIR || path.join(process.cwd(), "packages", "forge");
  const pidFile = path.join(FORGE_ROOT, ".pids", "eval-service.pid");
  try {
    const raw = fs.readFileSync(pidFile, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (!Number.isFinite(pid)) return { pid: null, alive: false };
    try {
      process.kill(pid, 0);
      return { pid, alive: true };
    } catch {
      return { pid, alive: false };
    }
  } catch {
    return { pid: null, alive: false };
  }
}

function getServiceStatus(): ServiceStatus {
  const pidRunning = isEvalServiceRunning();
  const { pid, alive: pidAlive } = readEvalPid();

  let recentlyActive = false;
  let activeJobId: string | null = null;
  let activeJobProgress: Record<string, unknown> | null = null;
  let queueDepth = 0;
  let lastCompletedAt: string | null = null;
  let lastError: string | null = null;

  try {
    const Database = require("better-sqlite3");
    const path = require("path");
    const fs = require("fs");
    const FORGE_ROOT =
      process.env.FORGE_DATA_DIR || path.join(process.cwd(), "packages", "forge");
    const DB_PATH = path.join(FORGE_ROOT, "forge.db");
    if (fs.existsSync(DB_PATH)) {
      const db = new Database(DB_PATH, { readonly: true });

      // Currently running eval job
      const runningJob = db
        .prepare(
          `SELECT id, progress FROM tool_jobs WHERE status = 'running' AND tool_name = 'eval_player' LIMIT 1`,
        )
        .get() as { id: string; progress: string | null } | undefined;
      if (runningJob) {
        activeJobId = runningJob.id;
        if (runningJob.progress) {
          try { activeJobProgress = JSON.parse(runningJob.progress); } catch {}
        }
      }

      // Queue depth
      const pending = db
        .prepare(
          `SELECT COUNT(*) as c FROM tool_jobs WHERE status = 'pending' AND tool_name = 'eval_player'`,
        )
        .get() as { c: number };
      queueDepth = pending.c;

      // Recently active check
      const runningCount = db
        .prepare(`SELECT COUNT(*) as c FROM tool_jobs WHERE status = 'running'`)
        .get() as { c: number };
      const recent = db
        .prepare(
          `SELECT COUNT(*) as c FROM tool_jobs WHERE status IN ('completed', 'failed') AND completed_at > datetime('now', '-60 seconds')`,
        )
        .get() as { c: number };
      recentlyActive = runningCount.c > 0 || recent.c > 0;

      // Last completed
      const lastCompleted = db
        .prepare(
          `SELECT completed_at FROM tool_jobs WHERE tool_name = 'eval_player' AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`,
        )
        .get() as { completed_at: string } | undefined;
      lastCompletedAt = lastCompleted?.completed_at ?? null;

      // Last error
      const lastFailed = db
        .prepare(
          `SELECT error FROM tool_jobs WHERE tool_name = 'eval_player' AND status = 'failed' ORDER BY completed_at DESC LIMIT 1`,
        )
        .get() as { error: string | null } | undefined;
      lastError = lastFailed?.error ?? null;

      db.close();
    }
  } catch {}

  return {
    running: pidRunning || recentlyActive,
    recentlyActive,
    pid,
    pidAlive,
    activeJobId,
    activeJobProgress,
    queueDepth,
    lastCompletedAt,
    lastError,
  };
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

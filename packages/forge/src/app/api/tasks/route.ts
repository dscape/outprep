import { NextRequest, NextResponse } from "next/server";

/**
 * Check if a process with the given PID is alive.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an agent process is alive by reading its PID file.
 */
function isAgentAlive(agentId: string, pidsDir: string): boolean {
  const fs = require("fs");
  const path = require("path");
  try {
    const raw = fs.readFileSync(path.join(pidsDir, `agent-${agentId}.pid`), "utf-8");
    const pid = parseInt(raw.trim(), 10);
    return Number.isFinite(pid) && isPidAlive(pid);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") ?? "active";
  const type = request.nextUrl.searchParams.get("type") ?? "all";

  try {
    const Database = require("better-sqlite3");
    const path = require("path");
    const fs = require("fs");
    const FORGE_ROOT =
      process.env.FORGE_DATA_DIR || process.cwd();
    const DB_PATH = path.join(FORGE_ROOT, "forge.db");
    const PIDS_DIR = path.join(FORGE_ROOT, ".pids");

    if (!fs.existsSync(DB_PATH)) {
      return NextResponse.json({ toolJobs: [], permissionRequests: [], counts: { pendingToolJobs: 0, runningToolJobs: 0, pendingPermissions: 0 } });
    }

    // Open read-write for archive sweep + migrations
    const db = new Database(DB_PATH);
    try { db.exec(`ALTER TABLE tool_jobs ADD COLUMN archived_at TEXT`); } catch {}
    try { db.exec(`ALTER TABLE tool_jobs ADD COLUMN retry_count INTEGER DEFAULT 0`); } catch {}
    try { db.exec(`ALTER TABLE tool_jobs ADD COLUMN progress TEXT`); } catch {}

    // ── Auto-archive orphaned tasks ──
    // Find agents with pending/running blocking jobs, check if alive
    const orphanCandidates = db.prepare(
      `SELECT DISTINCT agent_id FROM tool_jobs WHERE agent_id IS NOT NULL AND status IN ('pending', 'running') AND blocking = 1`
    ).all() as { agent_id: string }[];

    const now = new Date().toISOString();
    for (const { agent_id } of orphanCandidates) {
      if (!isAgentAlive(agent_id, PIDS_DIR)) {
        db.prepare(
          `UPDATE tool_jobs SET status = 'archived', archived_at = ? WHERE agent_id = ? AND status IN ('pending', 'running')`
        ).run(now, agent_id);
      }
    }

    let toolJobs: any[] = [];
    let permissionRequests: any[] = [];

    // Tool jobs
    if (type === "all" || type === "tool_job" || !["permission"].includes(type)) {
      // Apply type filter for specific tool names
      const toolTypeFilter = ["eval_player", "oracle", "web_search", "web_fetch", "code_prompt"].includes(type)
        ? `AND tj.tool_name = '${type}'`
        : type === "tool_job" ? "" : "";

      const statusFilter =
        status === "all"
          ? ""
          : status === "active"
            ? "AND tj.archived_at IS NULL"
            : status === "archived"
              ? "AND tj.status = 'archived'"
              : `AND tj.status = '${status}'`;

      // Skip tool jobs when filtering for permissions only
      if (type !== "permission") {
        toolJobs = db
          .prepare(
            `SELECT tj.*, a.name as agent_name
             FROM tool_jobs tj
             LEFT JOIN agents a ON a.id = tj.agent_id
             WHERE 1=1 ${statusFilter} ${toolTypeFilter}
             ORDER BY
               CASE WHEN tj.status IN ('pending', 'running') THEN 0 ELSE 1 END,
               tj.created_at DESC
             LIMIT 200`,
          )
          .all();
      }
    }

    // Permission requests
    if (type === "all" || type === "permission") {
      const permStatusFilter =
        status === "all"
          ? ""
          : status === "active"
            ? "AND pr.status = 'pending'"
            : status === "archived"
              ? "AND 0" // permissions don't have archived state
              : status === "pending"
                ? "AND pr.status = 'pending'"
                : status === "running"
                  ? "AND 0"
                  : `AND pr.status = '${status}'`;

      permissionRequests = db
        .prepare(
          `SELECT pr.*, a.name as agent_name
           FROM permission_requests pr
           LEFT JOIN agents a ON a.id = pr.agent_id
           WHERE 1=1 ${permStatusFilter}
           ORDER BY
             CASE WHEN pr.status = 'pending' THEN 0 ELSE 1 END,
             pr.requested_at DESC
           LIMIT 200`,
        )
        .all();
    }

    // Counts (always computed, ignoring filters — exclude archived)
    const pendingToolJobs = db
      .prepare(`SELECT COUNT(*) as c FROM tool_jobs WHERE status = 'pending'`)
      .get() as any;
    const runningToolJobs = db
      .prepare(`SELECT COUNT(*) as c FROM tool_jobs WHERE status = 'running'`)
      .get() as any;
    const pendingPermissions = db
      .prepare(`SELECT COUNT(*) as c FROM permission_requests WHERE status = 'pending'`)
      .get() as any;

    db.close();

    return NextResponse.json({
      toolJobs,
      permissionRequests,
      counts: {
        pendingToolJobs: pendingToolJobs?.c ?? 0,
        runningToolJobs: runningToolJobs?.c ?? 0,
        pendingPermissions: pendingPermissions?.c ?? 0,
      },
    });
  } catch {
    return NextResponse.json({
      toolJobs: [],
      permissionRequests: [],
      counts: { pendingToolJobs: 0, runningToolJobs: 0, pendingPermissions: 0 },
    });
  }
}

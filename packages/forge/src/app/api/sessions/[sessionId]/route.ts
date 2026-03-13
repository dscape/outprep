import { NextRequest, NextResponse } from "next/server";
import { loadForgeState } from "@/lib/forge";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const FORGE_ROOT = process.env.FORGE_DATA_DIR || path.join(process.cwd(), "packages", "forge");
const STATE_PATH = path.join(FORGE_ROOT, "forge-state.json");
const PIDS_DIR = path.join(FORGE_ROOT, ".pids");

function isSessionRunning(sessionId: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(PIDS_DIR, `${sessionId}.pid`), "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (!Number.isFinite(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const state = loadForgeState();

  const sessionIdx = state.sessions.findIndex((s) => s.id === sessionId);
  if (sessionIdx === -1) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = state.sessions[sessionIdx];

  // Prevent deleting a running session
  if (isSessionRunning(sessionId)) {
    return NextResponse.json(
      { error: "Cannot delete a running session. Stop the agent first." },
      { status: 409 },
    );
  }

  // Try to destroy sandbox (git worktree)
  try {
    const repoRoot = process.cwd();
    const worktreeDir = path.join(repoRoot, ".worktrees", sessionId);
    if (fs.existsSync(worktreeDir)) {
      execSync(`git worktree remove --force "${worktreeDir}"`, {
        cwd: repoRoot,
        stdio: "ignore",
      });
    }
    // Also try removing the branch
    if (session.worktreeBranch) {
      try {
        execSync(`git branch -D "${session.worktreeBranch}"`, {
          cwd: repoRoot,
          stdio: "ignore",
        });
      } catch {
        // Branch may already be deleted
      }
    }
  } catch {
    // Sandbox cleanup is best-effort
  }

  // Clean up agent references
  for (const agent of state.agents) {
    if (agent.currentSessionId === sessionId) {
      agent.currentSessionId = null;
    }
    agent.sessionHistory = agent.sessionHistory.filter(
      (h) => h.sessionId !== sessionId
    );
  }

  // Remove session from state
  state.sessions.splice(sessionIdx, 1);
  if (state.activeSessionId === sessionId) {
    state.activeSessionId = null;
  }

  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  return NextResponse.json({ ok: true });
}

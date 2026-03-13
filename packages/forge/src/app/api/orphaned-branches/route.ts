import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import path from "node:path";
import { loadForgeState } from "@/lib/forge";

export async function GET() {
  try {
    const repoRoot = process.cwd();
    const forgeRoot = process.env.FORGE_DATA_DIR || path.join(repoRoot, "packages", "forge");
    const sessionsDir = path.join(forgeRoot, "sessions");

    const output = execSync("git worktree list --porcelain", {
      cwd: repoRoot,
      encoding: "utf-8",
    });

    // Parse worktree list for research/* branches inside sessions dir only
    const blocks = output.split("\n\n").filter(Boolean);
    const worktrees: { path: string; branch: string; sessionId: string }[] = [];

    for (const block of blocks) {
      const lines = block.split("\n");
      const pathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));
      if (!pathLine || !branchLine) continue;

      const worktreePath = pathLine.replace("worktree ", "");
      const branch = branchLine.replace("branch refs/heads/", "");
      if (branch.startsWith("research/") || branch.startsWith("forge/")) {
        // Only include worktrees inside the sessions directory —
        // never match the root repo or other external worktrees
        if (!worktreePath.startsWith(sessionsDir)) continue;

        const sessionId = branch.replace(/^(research|forge)\//, "");
        worktrees.push({ path: worktreePath, branch, sessionId });
      }
    }

    if (worktrees.length === 0) {
      return NextResponse.json({ orphaned: [] });
    }

    // Cross-reference with forge state
    const state = loadForgeState();
    const activeSessionIds = new Set(
      (state?.sessions ?? [])
        .filter((s) => s.status === "active" || s.status === "paused")
        .map((s) => s.id)
    );

    const orphaned = worktrees.filter((wt) => !activeSessionIds.has(wt.sessionId));

    return NextResponse.json({
      orphaned: orphaned.map((wt) => ({
        branch: wt.branch,
        path: wt.path,
        command: `git worktree remove "${wt.path}" --force && git branch -D "${wt.branch}"`,
      })),
    });
  } catch {
    return NextResponse.json({ orphaned: [] });
  }
}

/**
 * Git worktree sandbox — isolates agent modifications.
 *
 * Creates a git worktree so the agent can modify any file
 * without affecting the main working tree. The real safety
 * boundary is the Anthropic Sandbox Runtime (added separately).
 * The harness runs inside the worktree, naturally resolving
 * @outprep/engine to the modified copy.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORGE_ROOT = join(__dirname, "..", "..");
const REPO_ROOT = join(FORGE_ROOT, "..", "..");
const SESSIONS_DIR = join(FORGE_ROOT, "sessions");

export interface SandboxInfo {
  sessionId: string;
  worktreePath: string;
  branchName: string;
  enginePath: string;
  harnessPath: string;
}

/**
 * Create a new git worktree for a research session.
 * The worktree gets its own branch based on the current HEAD.
 */
export function createSandbox(sessionId: string): SandboxInfo {
  const branchName = `research/${sessionId}`;
  const worktreePath = join(SESSIONS_DIR, sessionId);

  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  if (existsSync(worktreePath)) {
    throw new Error(
      `Sandbox already exists at ${worktreePath}. ` +
        `Use destroySandbox() first or pick a different session ID.`
    );
  }

  // Create worktree with a new branch from HEAD
  execSync(`git worktree add -b "${branchName}" "${worktreePath}" HEAD`, {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });

  // Install dependencies in the worktree (needed for node_modules resolution)
  execSync("npm install --ignore-scripts", {
    cwd: worktreePath,
    stdio: "pipe",
    timeout: 60_000,
  });

  return {
    sessionId,
    worktreePath,
    branchName,
    enginePath: join(worktreePath, "packages", "engine"),
    harnessPath: join(worktreePath, "packages", "harness"),
  };
}

/**
 * Get diff between sandbox engine and main branch engine.
 */
export function getSandboxDiff(sandbox: SandboxInfo): string {
  try {
    const diff = execSync("git diff HEAD", {
      cwd: sandbox.worktreePath,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return diff || "(no changes)";
  } catch {
    return "(failed to compute diff)";
  }
}

/**
 * Commit current sandbox changes (for checkpointing).
 */
export function commitSandbox(sandbox: SandboxInfo, message: string): string {
  try {
    execSync("git add -A", { cwd: sandbox.worktreePath, stdio: "pipe" });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: sandbox.worktreePath,
      stdio: "pipe",
    });
    const hash = execSync("git rev-parse --short HEAD", {
      cwd: sandbox.worktreePath,
      encoding: "utf-8",
    }).trim();
    return hash;
  } catch {
    return "(nothing to commit)";
  }
}

/**
 * Push a branch to the remote origin.
 * Used for auto-pushing positive experiment results.
 */
export function pushBranch(branchName: string): void {
  execSync(`git push -u origin "${branchName}"`, {
    cwd: REPO_ROOT,
    stdio: "pipe",
    timeout: 60_000,
  });
}

/**
 * Revert all changes in the sandbox worktree back to baseline.
 */
export function revertSandbox(sandbox: SandboxInfo): void {
  execSync("git checkout -- .", {
    cwd: sandbox.worktreePath,
    stdio: "pipe",
  });
}

/**
 * Revert a specific file in the sandbox worktree.
 * @param relativePath — path relative to the worktree root.
 */
export function revertFile(sandbox: SandboxInfo, relativePath: string): void {
  execSync(`git checkout -- "${relativePath}"`, {
    cwd: sandbox.worktreePath,
    stdio: "pipe",
  });
}

/**
 * Run TypeScript type-checking on the sandbox engine.
 * Returns empty string on success, error output on failure.
 */
export function typecheckSandbox(sandbox: SandboxInfo): string {
  try {
    execSync("npx tsc --noEmit", {
      cwd: sandbox.enginePath,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
    });
    return "";
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string };
    return error.stdout || error.stderr || "typecheck failed";
  }
}

/**
 * Cherry-pick sandbox commits onto main (for accepting improvements).
 */
export function acceptSandbox(sandbox: SandboxInfo): string {
  const branchName = sandbox.branchName;

  // Get list of commits on the forge branch that aren't on main
  const commits = execSync(
    `git log main..${branchName} --oneline --reverse`,
    { cwd: REPO_ROOT, encoding: "utf-8" }
  ).trim();

  if (!commits) return "No commits to merge";

  // Cherry-pick each commit onto main
  execSync("git checkout main", { cwd: REPO_ROOT, stdio: "pipe" });
  execSync(`git cherry-pick main..${branchName}`, {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });

  return `Merged commits:\n${commits}`;
}

/**
 * Destroy the sandbox worktree and delete the branch.
 */
export function destroySandbox(sandbox: SandboxInfo): void {
  // Safety: never destroy a worktree outside the sessions directory
  if (!sandbox.worktreePath.startsWith(SESSIONS_DIR)) {
    throw new Error(
      `Refusing to destroy sandbox at "${sandbox.worktreePath}" — ` +
        `path is outside sessions directory "${SESSIONS_DIR}"`
    );
  }

  try {
    // Remove the worktree
    execSync(`git worktree remove "${sandbox.worktreePath}" --force`, {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  } catch {
    // Fallback: manual removal if git worktree remove fails
    if (existsSync(sandbox.worktreePath)) {
      rmSync(sandbox.worktreePath, { recursive: true, force: true });
    }
    execSync("git worktree prune", { cwd: REPO_ROOT, stdio: "pipe" });
  }

  // Delete the branch
  try {
    execSync(`git branch -D "${sandbox.branchName}"`, {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  } catch {
    // Branch may not exist if worktree creation failed partway
  }
}

/**
 * List all active forge sandboxes.
 */
export function listSandboxes(): SandboxInfo[] {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });

    const sandboxes: SandboxInfo[] = [];
    const blocks = output.split("\n\n").filter(Boolean);

    for (const block of blocks) {
      const lines = block.split("\n");
      const pathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));

      if (pathLine && branchLine) {
        const worktreePath = pathLine.replace("worktree ", "");
        const branch = branchLine.replace("branch refs/heads/", "");

        if (branch.startsWith("research/") || branch.startsWith("forge/")) {
          // Only include worktrees inside the sessions directory —
          // never match the root repo or other external worktrees
          if (!worktreePath.startsWith(SESSIONS_DIR)) continue;

          const sessionId = branch.replace(/^(research|forge)\//, "");
          sandboxes.push({
            sessionId,
            worktreePath,
            branchName: branch,
            enginePath: join(worktreePath, "packages", "engine"),
            harnessPath: join(worktreePath, "packages", "harness"),
          });
        }
      }
    }

    return sandboxes;
  } catch {
    return [];
  }
}


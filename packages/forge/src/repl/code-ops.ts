/**
 * forge.code.* — Source code operations with change tracking.
 *
 * All operations target the sandbox worktree, so modifications
 * are isolated from the main working tree. Agents may modify any
 * file within the worktree — the real safety boundary is the
 * Anthropic Sandbox Runtime.
 *
 * Code modifications are delegated to Claude Code CLI (`claude -p`)
 * via the `prompt()` method instead of direct file writes.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SandboxInfo } from "./sandbox";
import {
  getSandboxDiff,
  revertSandbox,
  revertFile,
  typecheckSandbox,
} from "./sandbox";
import type { CodeChange } from "../state/types";

/* ── Change tracker ────────────────────────────────────────── */

const changesBySession = new Map<string, CodeChange[]>();

function getChanges(sessionId: string): CodeChange[] {
  if (!changesBySession.has(sessionId)) {
    changesBySession.set(sessionId, []);
  }
  return changesBySession.get(sessionId)!;
}

function recordChange(
  sandbox: SandboxInfo,
  file: string,
  description: string,
  diff: string
): CodeChange {
  const change: CodeChange = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    file,
    description,
    hypothesis: "",
    diff,
    type: "code",
  };
  getChanges(sandbox.sessionId).push(change);
  return change;
}

/* ── Resolve file path ─────────────────────────────────────── */

function resolveWorktreePath(sandbox: SandboxInfo, file: string): string {
  return join(sandbox.worktreePath, file);
}

/* ── Public API ────────────────────────────────────────────── */

export interface CodeOps {
  read(file: string): string;
  prompt(instruction: string): string;
  diff(): string;
  revert(file?: string): void;
  typecheck(): string;
  /** Access the tracked changes list (for session state sync). */
  getTrackedChanges(): CodeChange[];
}

export function createCodeOps(sandbox: SandboxInfo): CodeOps {
  return {
    read(file: string): string {
      const fullPath = resolveWorktreePath(sandbox, file);
      return readFileSync(fullPath, "utf-8");
    },

    prompt(instruction: string): string {
      const fullInstruction = [
        `You are modifying a chess engine.`,
        `You may modify any file within the working directory: ${sandbox.worktreePath}`,
        ``,
        instruction,
      ].join("\n");

      let output: string;
      try {
        output = execSync(
          `claude -p ${JSON.stringify(fullInstruction)}`,
          {
            cwd: sandbox.worktreePath,
            encoding: "utf-8",
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env },
          }
        );
      } catch (err: unknown) {
        const error = err as { stdout?: string; stderr?: string; message?: string };
        return `Error from Claude Code: ${error.stderr || error.message || "unknown error"}`;
      }

      // Track changes if any were made
      const diff = getSandboxDiff(sandbox);
      if (diff !== "(no changes)") {
        recordChange(
          sandbox,
          "(claude-code)",
          `prompt: ${instruction.slice(0, 100)}`,
          diff
        );
      }

      return output;
    },

    diff(): string {
      return getSandboxDiff(sandbox);
    },

    revert(file?: string): void {
      if (file) {
        revertFile(sandbox, file);
        // Remove tracked changes for this file
        const changes = getChanges(sandbox.sessionId);
        const filtered = changes.filter((c) => c.file !== file);
        changesBySession.set(sandbox.sessionId, filtered);
      } else {
        revertSandbox(sandbox);
        // Clear all tracked changes
        changesBySession.set(sandbox.sessionId, []);
      }
    },

    typecheck(): string {
      return typecheckSandbox(sandbox);
    },

    getTrackedChanges(): CodeChange[] {
      return getChanges(sandbox.sessionId);
    },
  };
}

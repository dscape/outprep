/**
 * forge.code.* — Engine source code operations with change tracking.
 *
 * All operations target the sandbox worktree's engine, so modifications
 * are isolated from the main working tree.
 *
 * Code modifications are delegated to Claude Code CLI (`claude -p`)
 * via the `prompt()` method instead of direct file writes.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SandboxInfo, ModifiableFile } from "./sandbox";
import {
  MODIFIABLE_ENGINE_FILES,
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

function resolveEnginePath(sandbox: SandboxInfo, file: ModifiableFile): string {
  return join(sandbox.enginePath, file);
}

/* ── Public API ────────────────────────────────────────────── */

export interface CodeOps {
  read(file: ModifiableFile): string;
  prompt(instruction: string): string;
  diff(): string;
  revert(file?: ModifiableFile): void;
  typecheck(): string;
  listModifiable(): string[];
  /** Access the tracked changes list (for session state sync). */
  getTrackedChanges(): CodeChange[];
}

export function createCodeOps(sandbox: SandboxInfo): CodeOps {
  return {
    read(file: ModifiableFile): string {
      const fullPath = resolveEnginePath(sandbox, file);
      return readFileSync(fullPath, "utf-8");
    },

    prompt(instruction: string): string {
      const fileList = MODIFIABLE_ENGINE_FILES.join(", ");
      const fullInstruction = [
        `You are modifying a chess engine. Only modify these files: ${fileList}.`,
        `Working directory: ${sandbox.enginePath}`,
        ``,
        instruction,
      ].join("\n");

      let output: string;
      try {
        output = execSync(
          `claude -p ${JSON.stringify(fullInstruction)}`,
          {
            cwd: sandbox.enginePath,
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

    revert(file?: ModifiableFile): void {
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

    listModifiable(): string[] {
      return [...MODIFIABLE_ENGINE_FILES];
    },

    getTrackedChanges(): CodeChange[] {
      return getChanges(sandbox.sessionId);
    },
  };
}

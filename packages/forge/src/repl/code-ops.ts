/**
 * forge.code.* — Engine source code read/write/patch with change tracking.
 *
 * All operations target the sandbox worktree's engine, so modifications
 * are isolated from the main working tree.
 */

import { readFileSync, writeFileSync } from "node:fs";
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
  write(file: ModifiableFile, content: string): void;
  patch(
    file: ModifiableFile,
    opts: { search: string; replace: string }
  ): { matched: boolean };
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

    write(file: ModifiableFile, content: string): void {
      const fullPath = resolveEnginePath(sandbox, file);

      // Capture before-state for diff description
      let before = "";
      try {
        before = readFileSync(fullPath, "utf-8");
      } catch {
        // File may not exist yet (unlikely for engine files, but safe)
      }

      writeFileSync(fullPath, content, "utf-8");

      // Compute a short diff summary
      const beforeLines = before.split("\n").length;
      const afterLines = content.split("\n").length;
      const diffSummary =
        before === content
          ? "(no change)"
          : `${beforeLines} -> ${afterLines} lines`;

      recordChange(
        sandbox,
        file,
        `write ${file} (${diffSummary})`,
        getSandboxDiff(sandbox)
      );
    },

    patch(
      file: ModifiableFile,
      opts: { search: string; replace: string }
    ): { matched: boolean } {
      const fullPath = resolveEnginePath(sandbox, file);
      const content = readFileSync(fullPath, "utf-8");

      if (!content.includes(opts.search)) {
        return { matched: false };
      }

      const updated = content.replace(opts.search, opts.replace);
      writeFileSync(fullPath, updated, "utf-8");

      recordChange(
        sandbox,
        file,
        `patch ${file}: "${opts.search.slice(0, 60)}..." -> "${opts.replace.slice(0, 60)}..."`,
        getSandboxDiff(sandbox)
      );

      return { matched: true };
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

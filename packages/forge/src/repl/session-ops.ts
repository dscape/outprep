/**
 * forge.session.* — Session management operations.
 *
 * Checkpoint, accept, and reject provide the lifecycle control
 * for a forge research session. These coordinate between the
 * sandbox (git worktree) and the persistent state (forge-state.json).
 */

import type { SandboxInfo } from "./sandbox";
import {
  commitSandbox,
  acceptSandbox,
  revertSandbox,
  destroySandbox,
} from "./sandbox";
import type { ForgeSession, ForgeState } from "../state/types";
import { saveState, updateSession } from "../state/forge-state";
import type { CodeOps } from "./code-ops";
import type { ConfigOps } from "./config-ops";

/* ── Public API ────────────────────────────────────────────── */

export interface SessionOps {
  /** Save current session state and commit sandbox changes. */
  checkpoint(): string;
  /** Merge sandbox changes to main branch, mark session completed. */
  accept(): string;
  /** Discard all sandbox changes, mark session abandoned. */
  reject(): void;
}

export function createSessionOps(
  sandbox: SandboxInfo,
  session: ForgeSession,
  state: ForgeState,
  codeOps: CodeOps,
  configOps: ConfigOps
): SessionOps {
  return {
    checkpoint(): string {
      // Sync tracked changes into the session
      updateSession(state, session.id, (s) => {
        s.activeChanges = codeOps.getTrackedChanges();
      });

      // Commit the sandbox worktree
      const experimentCount = session.experiments.length;
      const changeCount = session.activeChanges.length;
      const message = [
        `forge: checkpoint ${session.name}`,
        "",
        `Experiments: ${experimentCount}`,
        `Active changes: ${changeCount}`,
        `Timestamp: ${new Date().toISOString()}`,
      ].join("\n");

      const hash = commitSandbox(sandbox, message);

      // Save persistent state
      saveState(state);

      return `Checkpoint saved (commit: ${hash})`;
    },

    accept(): string {
      // Sync final state
      updateSession(state, session.id, (s) => {
        s.activeChanges = codeOps.getTrackedChanges();
        s.status = "completed";
      });

      // Commit any uncommitted changes first
      commitSandbox(sandbox, `forge: final changes for ${session.name}`);

      // Cherry-pick sandbox commits onto main
      const mergeInfo = acceptSandbox(sandbox);

      // Clean up sandbox
      destroySandbox(sandbox);

      // Deactivate session
      state.activeSessionId = null;
      saveState(state);

      return mergeInfo;
    },

    reject(): void {
      // Revert all changes in the sandbox
      revertSandbox(sandbox);

      // Mark session as abandoned
      updateSession(state, session.id, (s) => {
        s.status = "abandoned";
        s.activeChanges = [];
      });

      // Clean up sandbox
      destroySandbox(sandbox);

      // Deactivate session
      state.activeSessionId = null;
      saveState(state);
    },
  };
}

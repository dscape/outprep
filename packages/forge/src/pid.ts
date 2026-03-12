/**
 * PID file tracking for forge agent processes.
 *
 * Writes PID files to .pids/ so the CLI can detect running agents
 * without relying on the Next.js in-memory process registry.
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PIDS_DIR = join(__dirname, "..", ".pids");

export function writePid(sessionId: string): void {
  mkdirSync(PIDS_DIR, { recursive: true });
  writeFileSync(join(PIDS_DIR, `${sessionId}.pid`), String(process.pid));
}

export function removePid(sessionId: string): void {
  try {
    unlinkSync(join(PIDS_DIR, `${sessionId}.pid`));
  } catch {
    // Ignore — file may already be gone
  }
}

export function readPid(sessionId: string): number | null {
  try {
    const raw = readFileSync(join(PIDS_DIR, `${sessionId}.pid`), "utf-8");
    const pid = parseInt(raw.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/* ── Agent PID tracking ────────────────────────────────────── */

export function writeAgentPid(agentId: string): void {
  mkdirSync(PIDS_DIR, { recursive: true });
  writeFileSync(join(PIDS_DIR, `agent-${agentId}.pid`), String(process.pid));
}

export function removeAgentPid(agentId: string): void {
  try {
    unlinkSync(join(PIDS_DIR, `agent-${agentId}.pid`));
  } catch {
    // Ignore — file may already be gone
  }
}

export function readAgentPid(agentId: string): number | null {
  try {
    const raw = readFileSync(join(PIDS_DIR, `agent-${agentId}.pid`), "utf-8");
    const pid = parseInt(raw.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** List all agent IDs that have PID files */
export function listAgentPids(): string[] {
  try {
    return readdirSync(PIDS_DIR)
      .filter((f: string) => f.startsWith("agent-") && f.endsWith(".pid"))
      .map((f: string) => f.slice("agent-".length, -".pid".length));
  } catch {
    return [];
  }
}

/** Remove PID files for dead processes (both session and agent PIDs) */
export function cleanStalePids(): string[] {
  const cleaned: string[] = [];
  try {
    const files = readdirSync(PIDS_DIR) as string[];
    for (const f of files) {
      if (!f.endsWith('.pid')) continue;
      try {
        const raw = readFileSync(join(PIDS_DIR, f), "utf-8");
        const pid = parseInt(raw.trim(), 10);
        if (Number.isFinite(pid) && !isProcessRunning(pid)) {
          unlinkSync(join(PIDS_DIR, f));
          cleaned.push(f);
        }
      } catch {
        // File may have been removed concurrently
      }
    }
  } catch {
    // .pids dir doesn't exist yet
  }
  return cleaned;
}

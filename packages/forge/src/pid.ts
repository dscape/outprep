/**
 * PID file tracking for forge agent processes.
 *
 * Writes PID files to .pids/ so the CLI can detect running agents
 * without relying on the Next.js in-memory process registry.
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIDS_DIR = join(__dirname, "..", ".pids");

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

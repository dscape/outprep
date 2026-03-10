/**
 * Forge process registry — tracks running forge CLI child processes.
 *
 * This module manages spawning, tracking, and stopping forge sessions
 * from the Next.js API routes. Processes are tracked in-memory and
 * will be lost on server restart (acceptable for a local dev tool).
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { markSessionPausedIfActive } from "./forge";

const PROJECT_ROOT = process.cwd();
const FORGE_CLI = path.join(PROJECT_ROOT, "packages", "forge", "src", "cli.ts");

interface RunningProcess {
  process: ChildProcess;
  sessionId: string;
  startedAt: string;
  exitCode: number | null;
  stderrTail: string;
}

const running = new Map<string, RunningProcess>();
const finished = new Map<string, { exitCode: number | null; error: string }>();

export interface StartSessionOpts {
  name?: string;
  players: string[];
  focus?: string;
  maxExperiments?: number;
  seed?: number;
  quick?: boolean;
}

export function startSession(opts: StartSessionOpts): { sessionId: string; error?: string } {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      sessionId: "",
      error: "ANTHROPIC_API_KEY is not configured. Add it to .env or .env.local and restart the dev server.",
    };
  }

  const args = ["tsx", FORGE_CLI, "research"];

  if (opts.name) args.push("--name", opts.name);
  args.push("--players", opts.players.join(","));
  if (opts.focus) args.push("--focus", opts.focus);
  if (opts.maxExperiments) args.push("--max-experiments", String(opts.maxExperiments));
  if (opts.seed) args.push("--seed", String(opts.seed));
  if (opts.quick) args.push("--quick");

  const child = spawn("npx", args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  // Generate a temporary ID; the real session ID will be in forge-state.json
  // once the CLI creates it. We use the name as a lookup key.
  const tempId = opts.name || `session-${Date.now()}`;

  const entry: RunningProcess = {
    process: child,
    sessionId: tempId,
    startedAt: new Date().toISOString(),
    exitCode: null,
    stderrTail: "",
  };

  running.set(tempId, entry);

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      finished.set(tempId, { exitCode: code, error: entry.stderrTail.trim() });
    }
    running.delete(tempId);
    markSessionPausedIfActive(tempId);
  });

  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    console.error(`[forge:${tempId}]`, text);
    // Keep last 2KB of stderr for error reporting
    entry.stderrTail = (entry.stderrTail + text).slice(-2048);
  });

  return { sessionId: tempId };
}

export function resumeSession(sessionId: string): boolean {
  if (running.has(sessionId)) return false; // already running

  const args = ["tsx", FORGE_CLI, "resume", sessionId];

  const child = spawn("npx", args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const entry: RunningProcess = {
    process: child,
    sessionId,
    startedAt: new Date().toISOString(),
    exitCode: null,
    stderrTail: "",
  };

  running.set(sessionId, entry);

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      finished.set(sessionId, { exitCode: code, error: entry.stderrTail.trim() });
    }
    running.delete(sessionId);
    markSessionPausedIfActive(sessionId);
  });

  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    console.error(`[forge:${sessionId}]`, text);
    entry.stderrTail = (entry.stderrTail + text).slice(-2048);
  });

  return true;
}

export function stopSession(sessionId: string): boolean {
  const entry = running.get(sessionId);
  if (!entry) return false;

  // Send SIGINT for graceful pause (forge agent handles this)
  entry.process.kill("SIGINT");
  return true;
}

export function isRunning(sessionId: string): boolean {
  return running.has(sessionId);
}

export function getRunningSessionIds(): string[] {
  return Array.from(running.keys());
}

export function getProcessError(sessionId: string): { exitCode: number | null; error: string } | null {
  return finished.get(sessionId) ?? null;
}

/* ── Agent process management ─────────────────────────────── */

export interface StartAgentOpts {
  players: string[];
  focus?: string;
  maxExperiments?: number;
  seed?: number;
  quick?: boolean;
}

const runningAgents = new Map<string, RunningProcess>();

export function startAgentProcess(opts: StartAgentOpts): { agentId: string; error?: string } {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      agentId: "",
      error: "ANTHROPIC_API_KEY is not configured.",
    };
  }

  const args = ["tsx", FORGE_CLI, "agent", "start"];
  args.push("--players", opts.players.join(","));
  if (opts.focus) args.push("--focus", opts.focus);
  if (opts.maxExperiments) args.push("--max-experiments", String(opts.maxExperiments));
  if (opts.seed) args.push("--seed", String(opts.seed));
  if (opts.quick) args.push("--quick");

  const child = spawn("npx", args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const tempId = `agent-${Date.now()}`;

  const entry: RunningProcess = {
    process: child,
    sessionId: tempId,
    startedAt: new Date().toISOString(),
    exitCode: null,
    stderrTail: "",
  };

  runningAgents.set(tempId, entry);

  child.on("exit", (code) => {
    runningAgents.delete(tempId);
  });

  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    console.error(`[forge-agent:${tempId}]`, text);
    entry.stderrTail = (entry.stderrTail + text).slice(-2048);
  });

  return { agentId: tempId };
}

export function stopAgentProcess(agentId: string): boolean {
  const FORGE_ROOT = path.join(PROJECT_ROOT, "packages", "forge");
  const PIDS_DIR = path.join(FORGE_ROOT, ".pids");

  try {
    const fs = require("fs");
    const pidFile = path.join(PIDS_DIR, `agent-${agentId}.pid`);
    const raw = fs.readFileSync(pidFile, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (Number.isFinite(pid)) {
      process.kill(pid, "SIGINT");
      return true;
    }
  } catch {
    // PID file not found or process not running
  }
  return false;
}

export function stopAllAgents(): number {
  const { loadForgeState } = require("./forge");
  const fs = require("fs");
  const FORGE_ROOT = path.join(PROJECT_ROOT, "packages", "forge");
  const PIDS_DIR = path.join(FORGE_ROOT, ".pids");

  let stopped = 0;
  try {
    const files = fs.readdirSync(PIDS_DIR) as string[];
    for (const f of files) {
      if (f.startsWith("agent-") && f.endsWith(".pid")) {
        const raw = fs.readFileSync(path.join(PIDS_DIR, f), "utf-8");
        const pid = parseInt(raw.trim(), 10);
        if (Number.isFinite(pid)) {
          try {
            process.kill(pid, "SIGINT");
            stopped++;
          } catch { /* already dead */ }
        }
      }
    }
  } catch { /* dir doesn't exist */ }
  return stopped;
}

export function startAllAgents(): { started: number; error?: string } {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { started: 0, error: "ANTHROPIC_API_KEY is not configured." };
  }

  const args = ["tsx", FORGE_CLI, "agent", "start", "--all"];

  const child = spawn("npx", args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  child.stderr?.on("data", (data: Buffer) => {
    console.error(`[forge-agent:start-all]`, data.toString());
  });

  return { started: 1 };
}

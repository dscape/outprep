/**
 * Forge process registry — tracks running forge CLI child processes.
 *
 * Only manages agent processes. Sessions are created/managed by agents,
 * not by users directly.
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";

const PROJECT_ROOT = process.cwd();
const FORGE_CLI = path.join(PROJECT_ROOT, "packages", "forge", "src", "cli.ts");

interface RunningProcess {
  process: ChildProcess;
  sessionId: string;
  startedAt: string;
  exitCode: number | null;
  stderrTail: string;
}

/* ── Agent process management ─────────────────────────────── */

export interface StartAgentOpts {
  players?: string[];
  focus?: string;
  maxExperiments?: number;
  seed?: number;
  quick?: boolean;
  researchBias?: number;
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
  if (opts.players?.length) args.push("--players", opts.players.join(","));
  if (opts.focus) args.push("--focus", opts.focus);
  if (opts.maxExperiments) args.push("--max-experiments", String(opts.maxExperiments));
  if (opts.seed) args.push("--seed", String(opts.seed));
  if (opts.quick) args.push("--quick");
  if (opts.researchBias != null) args.push("--bias", String(opts.researchBias));

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

  child.on("exit", () => {
    runningAgents.delete(tempId);
  });

  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    console.error(`[forge-agent:${tempId}]`, text);
    entry.stderrTail = (entry.stderrTail + text).slice(-2048);
  });

  return { agentId: tempId };
}

// NOTE: Duplicates packages/forge/src/agent/shared.ts — kept separate for Next.js build compatibility
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

export function startSingleAgent(agentId: string): { started: boolean; error?: string } {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { started: false, error: "ANTHROPIC_API_KEY is not configured." };
  }

  const args = ["tsx", FORGE_CLI, "agent", "start", "--resume", agentId];

  const child = spawn("npx", args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  child.stderr?.on("data", (data: Buffer) => {
    console.error(`[forge-agent:resume:${agentId.slice(0, 8)}]`, data.toString());
  });

  return { started: true };
}

export function startAllAgents(): { started: number; error?: string } {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { started: 0, error: "ANTHROPIC_API_KEY is not configured." };
  }

  const fs = require("fs");
  const FORGE_ROOT = path.join(PROJECT_ROOT, "packages", "forge");
  const DB_PATH = path.join(FORGE_ROOT, "forge.db");
  const PIDS_DIR = path.join(FORGE_ROOT, ".pids");

  // Read agents from SQLite
  let agents: { id: string; name: string; status: string }[] = [];
  try {
    if (!fs.existsSync(DB_PATH)) {
      return { started: 0, error: "No forge database found." };
    }
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH, { readonly: true });
    agents = db.prepare("SELECT id, name, status FROM agents").all() as any[];
    db.close();
  } catch {
    return { started: 0, error: "Could not read forge database." };
  }

  // Find stopped agents (not currently running)
  const stopped = agents.filter((a) => {
    if (a.status === "running") {
      // Check if actually alive
      try {
        const raw = fs.readFileSync(path.join(PIDS_DIR, `agent-${a.id}.pid`), "utf-8");
        const pid = parseInt(raw.trim(), 10);
        if (Number.isFinite(pid)) {
          process.kill(pid, 0);
          return false; // actually running
        }
      } catch { /* no pid file or dead process */ }
    }
    return true;
  });

  // Start each agent as a separate process
  let started = 0;
  for (const a of stopped) {
    const result = startSingleAgent(a.id);
    if (result.started) started++;
  }

  return { started };
}

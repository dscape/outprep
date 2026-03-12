/**
 * Shared utilities for agent lifecycle management.
 *
 * Extracted from agent-manager.ts, agent-loop.ts, forge-process.ts,
 * and cli.ts to eliminate duplication.
 */

import { readAgentPid, isProcessRunning, PIDS_DIR } from "../pid";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Load and split player data for a research session.
 * Returns a record of playerData objects keyed by username.
 */
export async function buildPlayerData(
  usernames: string[],
  seed: number = 42,
  trainRatio: number = 0.8,
): Promise<Record<string, any>> {
  const { getGames, loadPlayer } = await import("../data/game-store");
  const { createSplit } = await import("../data/splits");

  const playerData: Record<string, any> = {};

  for (const username of usernames) {
    const meta = loadPlayer(username);
    const games = getGames(username);
    if (meta && games.length > 0) {
      const result = createSplit(games, { seed, trainRatio });
      playerData[username] = {
        meta,
        games,
        trainGames: result.trainGames,
        testGames: result.testGames,
        split: result.split,
      };
    }
  }

  return playerData;
}

/**
 * Stop an agent by its ID — reads the PID file and sends SIGINT.
 * Returns true if the signal was sent, false if the process wasn't running.
 */
export function stopAgentById(agentId: string): boolean {
  const pid = readAgentPid(agentId);
  if (pid === null || !isProcessRunning(pid)) return false;

  try {
    process.kill(pid, "SIGINT");
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop all running agents by scanning PID files.
 * Returns the number of agents stopped.
 */
export function stopAllAgentsFromPids(): number {
  let stopped = 0;
  try {
    const files = readdirSync(PIDS_DIR) as string[];
    for (const f of files) {
      if (f.startsWith("agent-") && f.endsWith(".pid")) {
        try {
          const raw = readFileSync(`${PIDS_DIR}/${f}`, "utf-8");
          const pid = parseInt(raw.trim(), 10);
          if (Number.isFinite(pid) && isProcessRunning(pid)) {
            process.kill(pid, "SIGINT");
            stopped++;
          }
        } catch { /* already dead */ }
      }
    }
  } catch { /* dir doesn't exist */ }
  return stopped;
}

/**
 * Get the ELO map for a list of player usernames.
 */
export async function getPlayerEloMap(usernames: string[]): Promise<Map<string, number>> {
  const { loadPlayer } = await import("../data/game-store");
  const elos = new Map<string, number>();
  for (const p of usernames) {
    const meta = loadPlayer(p);
    if (meta) elos.set(p, meta.estimatedElo);
  }
  return elos;
}

/**
 * Check if an agent process is alive by its agent ID.
 */
export function isAgentAlive(agentId: string): boolean {
  const pid = readAgentPid(agentId);
  return pid !== null && isProcessRunning(pid);
}

/**
 * Get detailed agent run status.
 */
export type AgentRunStatus =
  | { status: "running"; pid: number }
  | { status: "stopped" }
  | { status: "dead"; reason: string };

export function getAgentRunStatus(agentId: string): AgentRunStatus {
  const pid = readAgentPid(agentId);
  if (pid === null) return { status: "stopped" };
  if (isProcessRunning(pid)) return { status: "running", pid };
  return { status: "dead", reason: `PID ${pid} is not running` };
}

/**
 * Persistent state management for forge sessions.
 *
 * Saves/loads forge-state.json at the package root.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ForgeState, ForgeSession, ForgeAgent } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, "..", "..", "forge-state.json");

const EMPTY_STATE: ForgeState = {
  version: 2,
  sessions: [],
  agents: [],
  activeSessionId: null,
  lastCheckpoint: new Date().toISOString(),
};

/** Migrate v1 state to v2: add agents array and agentId to sessions */
function migrateState(state: any): ForgeState {
  if (!state.agents) state.agents = [];
  if (state.version === 1) {
    for (const s of state.sessions) {
      if (s.agentId === undefined) s.agentId = null;
    }
    state.version = 2;
  }
  return state as ForgeState;
}

export function loadState(): ForgeState {
  if (!existsSync(STATE_PATH)) return { ...EMPTY_STATE, agents: [] };

  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    const state = JSON.parse(raw);
    return migrateState(state);
  } catch (err) {
    console.error(`  ✗ Failed to load forge-state.json: ${err}`);
    return { ...EMPTY_STATE, agents: [] };
  }
}

export function saveState(state: ForgeState): void {
  state.lastCheckpoint = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function getActiveSession(state: ForgeState): ForgeSession | null {
  if (!state.activeSessionId) return null;
  return state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
}

export function updateSession(
  state: ForgeState,
  sessionId: string,
  updater: (session: ForgeSession) => void
): void {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  updater(session);
  session.updatedAt = new Date().toISOString();
  saveState(state);
}

export function updateAgent(
  state: ForgeState,
  agentId: string,
  updater: (agent: ForgeAgent) => void
): void {
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  updater(agent);
  agent.updatedAt = new Date().toISOString();
  saveState(state);
}

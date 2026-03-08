/**
 * Persistent state management for forge sessions.
 *
 * Saves/loads forge-state.json at the package root, following
 * the same pattern as the tuner's tuner-state.json.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ForgeState, ForgeSession } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, "..", "..", "forge-state.json");

const EMPTY_STATE: ForgeState = {
  version: 1,
  sessions: [],
  activeSessionId: null,
  lastCheckpoint: new Date().toISOString(),
};

export function loadState(): ForgeState {
  if (!existsSync(STATE_PATH)) return { ...EMPTY_STATE };

  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    const state = JSON.parse(raw) as ForgeState;
    if (state.version !== 1) {
      console.warn(`  ⚠ forge-state.json version ${state.version} — expected 1, loading anyway`);
    }
    return state;
  } catch (err) {
    console.error(`  ✗ Failed to load forge-state.json: ${err}`);
    return { ...EMPTY_STATE };
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

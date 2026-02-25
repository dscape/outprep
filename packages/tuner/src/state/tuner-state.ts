/**
 * Tuner state persistence — load, save, and checkpoint.
 *
 * State is stored in `tuner-state.json` at the package root.
 * Checkpointed after every experiment for crash-safe resume.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { DEFAULT_CONFIG } from "@outprep/engine";
import type { TunerState } from "./types";

const TUNER_ROOT = join(import.meta.dirname, "../..");
const STATE_PATH = join(TUNER_ROOT, "tuner-state.json");

/** Seed players for initial player pool (well-known Lichess accounts). */
const SEED_PLAYERS = [
  // Beginner band (1100-1400)
  { username: "chess_beginner_01", band: "beginner" as const, estimatedElo: 1200 },
  { username: "chess_beginner_02", band: "beginner" as const, estimatedElo: 1350 },
  // Intermediate band (1400-1700)
  { username: "chess_intermediate_01", band: "intermediate" as const, estimatedElo: 1500 },
  { username: "chess_intermediate_02", band: "intermediate" as const, estimatedElo: 1650 },
  // Advanced band (1700-2000)
  { username: "chess_advanced_01", band: "advanced" as const, estimatedElo: 1800 },
  { username: "chess_advanced_02", band: "advanced" as const, estimatedElo: 1950 },
  // Expert band (2000-2300)
  { username: "chess_expert_01", band: "expert" as const, estimatedElo: 2100 },
  { username: "chess_expert_02", band: "expert" as const, estimatedElo: 2250 },
  // Master band (2300+)
  { username: "DrNykterstein", band: "master" as const, estimatedElo: 2800 },
];

export function createInitialState(): TunerState {
  return {
    version: 1,
    cycle: 0,
    phase: "idle",
    playerPool: SEED_PLAYERS,
    datasets: [],
    currentPlan: null,
    bestConfig: DEFAULT_CONFIG,
    completedCycles: [],
    acceptedChanges: [],
    lastCheckpoint: new Date().toISOString(),
  };
}

export function loadState(): TunerState | null {
  if (!existsSync(STATE_PATH)) return null;
  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(raw) as TunerState;
  } catch {
    console.error("  Failed to parse tuner-state.json. Starting fresh.");
    return null;
  }
}

export function saveState(state: TunerState): void {
  state.lastCheckpoint = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

export function getOrCreateState(): TunerState {
  return loadState() ?? createInitialState();
}

export function getStatePath(): string {
  return STATE_PATH;
}

export function getTunerRoot(): string {
  return TUNER_ROOT;
}

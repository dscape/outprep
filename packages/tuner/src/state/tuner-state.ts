/**
 * Tuner state persistence — load, save, and checkpoint.
 *
 * State is stored in `tuner-state.json` at the package root.
 * Checkpointed after every experiment for crash-safe resume.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { DEFAULT_CONFIG, mergeConfig } from "@outprep/engine";
import type { TunerState } from "./types";

const TUNER_ROOT = join(import.meta.dirname, "../..");
const STATE_PATH = join(TUNER_ROOT, "tuner-state.json");

/** Seed players for initial player pool (well-known Lichess accounts). */
const SEED_PLAYERS = [
  // Beginner band (Lichess rapid ~1100-1400)
  { username: "benjoboli", band: "beginner" as const, estimatedElo: 1200 },
  { username: "ElizavetaPetrova", band: "beginner" as const, estimatedElo: 1200 },
  { username: "biciado", band: "beginner" as const, estimatedElo: 1300 },

  // Intermediate band (Lichess rapid ~1400-1700)
  { username: "Chess-Network", band: "intermediate" as const, estimatedElo: 1500 },
  { username: "Rodigheri", band: "intermediate" as const, estimatedElo: 1700 },

  // Advanced band (Lichess rapid ~1700-2000)
  { username: "Lance5500", band: "advanced" as const, estimatedElo: 1850 },
  { username: "Fins", band: "advanced" as const, estimatedElo: 1950 },

  // Expert band (Lichess rapid ~2000-2300)
  { username: "opperwezen", band: "expert" as const, estimatedElo: 2150 },
  { username: "BeepBeepImAJeep", band: "expert" as const, estimatedElo: 2250 },

  // Master band (Lichess rapid 2300+)
  { username: "penguingim1", band: "master" as const, estimatedElo: 2700 },
  // Andrew Tang — GM, bullet/blitz legend, very active on Lichess
  { username: "DrNykterstein", band: "master" as const, estimatedElo: 2850 },
  // Magnus Carlsen
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
  const state = loadState();
  if (!state) return createInitialState();

  // Backfill new config sections from DEFAULT_CONFIG.
  // mergeConfig(base, override) deep-merges one level — so tuner-optimized
  // values in bestConfig are preserved, but missing sections (e.g. moveStyle)
  // get filled from DEFAULT_CONFIG.
  state.bestConfig = mergeConfig(DEFAULT_CONFIG, state.bestConfig);

  return state;
}

export function getStatePath(): string {
  return STATE_PATH;
}

export function getTunerRoot(): string {
  return TUNER_ROOT;
}

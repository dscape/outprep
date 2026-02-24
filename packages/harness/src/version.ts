/**
 * Runtime version/metadata capture for test result traceability.
 *
 * Every result JSON includes a VersionInfo snapshot so you can trace
 * exactly which code and config produced the results.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, mergeConfig } from "@outprep/engine";
import type { BotConfig } from "@outprep/engine";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface VersionInfo {
  /** Short git commit hash at runtime */
  gitCommit: string;
  /** Whether the working tree had uncommitted changes */
  gitDirty: boolean;
  /** @outprep/engine package.json version */
  engineVersion: string;
  /** @outprep/harness package.json version */
  harnessVersion: string;
  /** Stockfish npm package version (semver range from package.json) */
  stockfishVersion: string;
}

/**
 * Capture git and package version info at runtime.
 * Degrades gracefully if not in a git repo.
 */
export function captureVersionInfo(): VersionInfo {
  let gitCommit = "unknown";
  let gitDirty = false;
  try {
    gitCommit = execSync("git rev-parse --short HEAD", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const status = execSync("git status --porcelain", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    gitDirty = status.length > 0;
  } catch {
    // Not in a git repo or git not available
  }

  const enginePkg = JSON.parse(
    readFileSync(join(__dirname, "../../engine/package.json"), "utf-8")
  );
  const harnessPkg = JSON.parse(
    readFileSync(join(__dirname, "../package.json"), "utf-8")
  );

  return {
    gitCommit,
    gitDirty,
    engineVersion: enginePkg.version ?? "unknown",
    harnessVersion: harnessPkg.version ?? "unknown",
    stockfishVersion: harnessPkg.dependencies?.stockfish ?? "unknown",
  };
}

/**
 * Resolve the full BotConfig from partial overrides.
 * Produces a complete snapshot of what actually ran — survives
 * changes to DEFAULT_CONFIG across engine versions.
 */
export function resolveFullConfig(
  overrides: Partial<BotConfig> | undefined
): BotConfig {
  return mergeConfig(DEFAULT_CONFIG, overrides);
}

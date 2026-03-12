/**
 * Detects incremental tuning patterns masquerading as exploration.
 *
 * Pattern: oracle query → small config change → re-query on same topic.
 * When detected, flags the experiment as INCREMENTAL rather than EXPLORATORY.
 */

import type { OracleRecord, ExperimentRecord } from "../state/types";

export interface IncrementalDetectionResult {
  detected: boolean;
  message: string;
  patternCount: number;
}

/**
 * Check if recent oracle + experiment history shows a tuning pattern.
 *
 * Heuristics:
 * 1. Two or more oracle queries with similar topics (word overlap > 50%)
 * 2. Interleaved with config-only experiments (no code changes)
 * 3. Config changes are small deltas on the same parameter paths
 */
export function detectIncrementalPattern(
  oracleHistory: OracleRecord[],
  experiments: ExperimentRecord[]
): IncrementalDetectionResult {
  if (oracleHistory.length < 2 || experiments.length < 2) {
    return { detected: false, message: "", patternCount: 0 };
  }

  // Look at the last 5 oracle queries and experiments
  const recentOracles = oracleHistory.slice(-5);
  const recentExperiments = experiments.slice(-5);

  let patternCount = 0;
  const reasons: string[] = [];

  // Check for similar oracle topics
  for (let i = 1; i < recentOracles.length; i++) {
    const prev = recentOracles[i - 1];
    const curr = recentOracles[i];
    const similarity = wordOverlap(prev.question, curr.question);
    if (similarity > 0.5) {
      patternCount++;
    }
  }

  // Check for config-only experiments between oracle queries
  const configOnlyCount = recentExperiments.filter(
    (exp) => exp.codeChanges.length === 0 && exp.configChanges.length > 0
  ).length;

  if (configOnlyCount >= 2 && patternCount >= 1) {
    reasons.push(
      `${configOnlyCount} recent experiments are config-only changes, ` +
      `with ${patternCount} similar oracle queries. This looks like parameter tuning, not exploration.`
    );
  }

  // Check for repeated config paths
  const configPaths = recentExperiments
    .flatMap((exp) => exp.configChanges.map((c) => c.path))
    .filter(Boolean);
  const pathCounts = new Map<string, number>();
  for (const path of configPaths) {
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
  }
  const repeatedPaths = [...pathCounts.entries()].filter(([, count]) => count >= 2);
  if (repeatedPaths.length > 0) {
    reasons.push(
      `Config paths tweaked repeatedly: ${repeatedPaths.map(([p, c]) => `${p} (${c}x)`).join(", ")}`
    );
    patternCount += repeatedPaths.length;
  }

  const detected = patternCount >= 2;
  const message = detected
    ? `INCREMENTAL pattern detected: ${reasons.join(" ")}\n` +
      `If this is intentional, use archetype: "incremental". ` +
      `If you meant to explore, try a fundamentally different approach.`
    : "";

  return { detected, message, patternCount };
}

/** Compute word overlap ratio between two strings (Jaccard similarity). */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

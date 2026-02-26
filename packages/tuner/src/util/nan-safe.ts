/**
 * NaN-safe utilities for metrics that survive JSON round-trips.
 *
 * Problem: JSON.stringify(NaN) → null → JSON.parse("null") → null
 * And isNaN(null) returns false (because Number(null) === 0).
 * So after reading metrics from disk, NaN fields become null and
 * slip through isNaN() guards, causing crashes on .toFixed() etc.
 *
 * This module provides:
 *  - nanSafe(v): returns NaN if v is null/undefined/NaN, otherwise Number(v)
 *  - sanitizeMetrics(m): deep-converts null→NaN for known CPL fields
 *  - sanitizeAggregatedResult(r): sanitizes an entire AggregatedResult
 */

import type { Metrics } from "@outprep/harness";
import type { AggregatedResult } from "../state/types";

/**
 * Convert a value that may be null (from JSON round-trip) back to NaN.
 * Safe to call on any numeric value — returns the number unchanged if valid.
 */
export function nanSafe(v: unknown): number {
  if (v == null) return NaN;
  const n = Number(v);
  return isNaN(n) ? NaN : n;
}

/**
 * Sanitize a Metrics object after JSON deserialization.
 * Converts null → NaN for CPL-related fields that may have been NaN
 * before serialization.
 */
export function sanitizeMetrics(m: Metrics): Metrics {
  m.avgActualCPL = nanSafe(m.avgActualCPL);
  m.avgBotCPL = nanSafe(m.avgBotCPL);
  m.cplDelta = nanSafe(m.cplDelta);

  // Sanitize per-phase metrics too
  if (m.byPhase) {
    for (const phase of ["opening", "middlegame", "endgame"] as const) {
      if (m.byPhase[phase]) {
        m.byPhase[phase].avgCPL = nanSafe(m.byPhase[phase].avgCPL);
        m.byPhase[phase].botAvgCPL = nanSafe(m.byPhase[phase].botAvgCPL);
      }
    }
  }

  return m;
}

/**
 * Sanitize an AggregatedResult (and all nested metrics) after JSON parse.
 */
export function sanitizeAggregatedResult(r: AggregatedResult): AggregatedResult {
  sanitizeMetrics(r.aggregatedMetrics);
  for (const dm of r.datasetMetrics) {
    sanitizeMetrics(dm.metrics);
  }
  return r;
}

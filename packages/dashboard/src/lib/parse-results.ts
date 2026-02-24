import type { TestResult, Metrics } from "../types";

/**
 * Validate and parse a JSON object as a TestResult.
 * Returns null if the shape doesn't match.
 */
export function parseTestResult(data: unknown): TestResult | null {
  if (typeof data !== "object" || data === null) return null;

  const obj = data as Record<string, unknown>;

  if (
    typeof obj.datasetName !== "string" ||
    typeof obj.username !== "string" ||
    typeof obj.timestamp !== "string" ||
    typeof obj.label !== "string" ||
    typeof obj.elo !== "number" ||
    typeof obj.metrics !== "object" ||
    !Array.isArray(obj.positions)
  ) {
    return null;
  }

  const metrics = obj.metrics as Metrics;
  if (
    typeof metrics.totalPositions !== "number" ||
    typeof metrics.matchRate !== "number"
  ) {
    return null;
  }

  return data as TestResult;
}

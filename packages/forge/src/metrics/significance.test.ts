import { describe, it, expect } from "vitest";
import {
  bootstrapCI,
  pairedPermutationTest,
  cohensD,
  computeSignificance,
} from "./significance";

/* ── cohensD ─────────────────────────────────────────────── */

describe("cohensD", () => {
  it("returns large positive d for clearly different groups (a > b)", () => {
    const a = [9, 10, 11, 10, 10];
    const b = [1, 2, 1, 2, 1];
    const d = cohensD(a, b);
    expect(d).toBeGreaterThan(2); // Very large effect
  });

  it("returns large negative d when b > a", () => {
    const a = [1, 2, 1, 2, 1];
    const b = [9, 10, 11, 10, 10];
    const d = cohensD(a, b);
    expect(d).toBeLessThan(-2);
  });

  it("returns 0 for identical groups", () => {
    const a = [5, 5, 5, 5];
    const b = [5, 5, 5, 5];
    const d = cohensD(a, b);
    expect(d).toBe(0);
  });

  it("returns 0 when groups have < 2 elements", () => {
    expect(cohensD([1], [2])).toBe(0);
    expect(cohensD([], [])).toBe(0);
  });

  it("handles non-zero variance correctly", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [2, 3, 4, 5, 6];
    const d = cohensD(a, b);
    // Mean difference is -1, pooled SD is ~1.58, so d ≈ -0.63
    expect(d).toBeCloseTo(-0.632, 2);
  });
});

/* ── bootstrapCI ─────────────────────────────────────────── */

describe("bootstrapCI", () => {
  it("returns [NaN, NaN] for empty input", () => {
    const [lo, hi] = bootstrapCI([], (s) => s.reduce((a, b) => a + b, 0) / s.length);
    expect(lo).toBeNaN();
    expect(hi).toBeNaN();
  });

  it("returns tight CI for constant values", () => {
    const values = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
    const [lo, hi] = bootstrapCI(values, (s) => s.reduce((a, b) => a + b, 0) / s.length);
    expect(lo).toBe(5);
    expect(hi).toBe(5);
  });

  it("is deterministic with the same seed", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const mean = (s: number[]) => s.reduce((a, b) => a + b, 0) / s.length;

    const [lo1, hi1] = bootstrapCI(values, mean, { seed: 123 });
    const [lo2, hi2] = bootstrapCI(values, mean, { seed: 123 });

    expect(lo1).toBe(lo2);
    expect(hi1).toBe(hi2);
  });

  it("produces different results with different seeds", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const mean = (s: number[]) => s.reduce((a, b) => a + b, 0) / s.length;

    const [lo1, hi1] = bootstrapCI(values, mean, { seed: 42 });
    const [lo2, hi2] = bootstrapCI(values, mean, { seed: 99 });

    // Very unlikely to be identical
    expect(lo1 === lo2 && hi1 === hi2).toBe(false);
  });

  it("lo <= hi for non-trivial data", () => {
    const values = [1, 3, 5, 7, 9, 2, 4, 6, 8, 10];
    const [lo, hi] = bootstrapCI(values, (s) => s.reduce((a, b) => a + b, 0) / s.length);
    expect(lo).toBeLessThanOrEqual(hi);
  });
});

/* ── pairedPermutationTest ───────────────────────────────── */

describe("pairedPermutationTest", () => {
  it("returns 1.0 for empty arrays", () => {
    expect(pairedPermutationTest([], [])).toBe(1.0);
  });

  it("returns high p-value for identical arrays (no difference)", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [1, 2, 3, 4, 5];
    const p = pairedPermutationTest(a, b, { seed: 42 });
    // All differences are 0 → every permutation gives the same result
    expect(p).toBe(1.0);
  });

  it("returns low p-value for clearly different arrays", () => {
    const a = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const b = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p = pairedPermutationTest(a, b, { seed: 42 });
    expect(p).toBeLessThan(0.01);
  });

  it("is deterministic with the same seed", () => {
    const a = [3, 5, 7, 9, 11];
    const b = [1, 2, 3, 4, 5];
    const p1 = pairedPermutationTest(a, b, { seed: 42 });
    const p2 = pairedPermutationTest(a, b, { seed: 42 });
    expect(p1).toBe(p2);
  });

  it("handles arrays of different lengths (uses shorter)", () => {
    const a = [10, 11, 12, 13, 14, 15];
    const b = [1, 2, 3];
    const p = pairedPermutationTest(a, b, { seed: 42 });
    // Only first 3 elements compared
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

/* ── computeSignificance ─────────────────────────────────── */

describe("computeSignificance", () => {
  it("returns significant=true for clearly different distributions", () => {
    const baseline = [0.3, 0.35, 0.32, 0.33, 0.31, 0.34, 0.30, 0.35, 0.33, 0.32];
    const experiment = [0.7, 0.72, 0.68, 0.71, 0.69, 0.73, 0.70, 0.72, 0.68, 0.71];
    const result = computeSignificance("moveAccuracy", baseline, experiment, { seed: 42 });

    expect(result.metricName).toBe("moveAccuracy");
    expect(result.significant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
    expect(Math.abs(result.effectSize)).toBeGreaterThan(0.2);
    expect(result.delta).toBeGreaterThan(0);
  });

  it("returns significant=false for identical distributions", () => {
    const values = [0.5, 0.52, 0.48, 0.51, 0.49, 0.50, 0.52, 0.48, 0.50, 0.51];
    const result = computeSignificance("moveAccuracy", values, values, { seed: 42 });

    expect(result.significant).toBe(false);
    expect(result.delta).toBe(0);
    expect(result.pValue).toBe(1.0);
  });

  it("computes correct delta (experiment - baseline)", () => {
    const baseline = [0.3, 0.3, 0.3, 0.3, 0.3];
    const experiment = [0.5, 0.5, 0.5, 0.5, 0.5];
    const result = computeSignificance("test", baseline, experiment, { seed: 42 });

    expect(result.baseline).toBeCloseTo(0.3);
    expect(result.experiment).toBeCloseTo(0.5);
    expect(result.delta).toBeCloseTo(0.2);
  });

  it("returns 95% CI that brackets the true difference", () => {
    const baseline = [0.3, 0.35, 0.32, 0.33, 0.31, 0.34, 0.30, 0.35, 0.33, 0.32];
    const experiment = [0.7, 0.72, 0.68, 0.71, 0.69, 0.73, 0.70, 0.72, 0.68, 0.71];
    const result = computeSignificance("test", baseline, experiment, { seed: 42 });

    // CI should be around the delta (~0.38) and not contain 0
    expect(result.ci95[0]).toBeGreaterThan(0);
    expect(result.ci95[1]).toBeGreaterThan(result.ci95[0]);
  });
});

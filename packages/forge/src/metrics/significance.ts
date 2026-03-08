/**
 * Statistical significance testing for experiment comparison.
 *
 * Provides bootstrap confidence intervals and paired permutation tests
 * to determine if metric changes are statistically meaningful.
 */

import type { SignificanceResult } from "../state/types";

/**
 * Seeded PRNG (same LCG as harness for consistency).
 */
function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Bootstrap confidence interval for a single metric.
 *
 * Resamples the data 1000 times, computes the metric on each resample,
 * and returns the 2.5th and 97.5th percentile as the 95% CI.
 */
export function bootstrapCI(
  values: number[],
  metric: (sample: number[]) => number,
  opts: { nResamples?: number; seed?: number } = {}
): [number, number] {
  const n = values.length;
  if (n === 0) return [NaN, NaN];

  const nResamples = opts.nResamples ?? 1000;
  const rng = createRng(opts.seed ?? 42);
  const estimates: number[] = [];

  for (let i = 0; i < nResamples; i++) {
    const sample: number[] = [];
    for (let j = 0; j < n; j++) {
      sample.push(values[Math.floor(rng() * n)]);
    }
    estimates.push(metric(sample));
  }

  estimates.sort((a, b) => a - b);
  const lo = estimates[Math.floor(nResamples * 0.025)];
  const hi = estimates[Math.floor(nResamples * 0.975)];
  return [lo, hi];
}

/**
 * Paired permutation test for two matched samples.
 *
 * Tests if the mean difference between A and B is significantly
 * different from zero. Returns a two-sided p-value.
 */
export function pairedPermutationTest(
  a: number[],
  b: number[],
  opts: { nPermutations?: number; seed?: number } = {}
): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1.0;

  const nPermutations = opts.nPermutations ?? 10000;
  const rng = createRng(opts.seed ?? 42);

  // Compute observed mean difference
  const diffs = a.slice(0, n).map((v, i) => v - b[i]);
  const observedMeanDiff = diffs.reduce((s, d) => s + d, 0) / n;
  const observedAbsDiff = Math.abs(observedMeanDiff);

  // Permutation: randomly flip the sign of each difference
  let moreExtreme = 0;
  for (let p = 0; p < nPermutations; p++) {
    let permMeanDiff = 0;
    for (let i = 0; i < n; i++) {
      const sign = rng() < 0.5 ? 1 : -1;
      permMeanDiff += sign * diffs[i];
    }
    permMeanDiff /= n;
    if (Math.abs(permMeanDiff) >= observedAbsDiff) {
      moreExtreme++;
    }
  }

  return moreExtreme / nPermutations;
}

/**
 * Cohen's d effect size for two independent samples.
 */
export function cohensD(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return 0;

  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;

  const varA =
    a.reduce((s, v) => s + (v - meanA) ** 2, 0) / (a.length - 1);
  const varB =
    b.reduce((s, v) => s + (v - meanB) ** 2, 0) / (b.length - 1);

  // Pooled standard deviation
  const pooledSD = Math.sqrt(
    ((a.length - 1) * varA + (b.length - 1) * varB) /
      (a.length + b.length - 2)
  );

  if (pooledSD === 0) return 0;
  return (meanA - meanB) / pooledSD;
}

/**
 * Full significance analysis between baseline and experiment.
 *
 * Takes position-level results (boolean matches) from both runs
 * and computes all significance metrics.
 */
export function computeSignificance(
  metricName: string,
  baselineValues: number[],
  experimentValues: number[],
  opts: { seed?: number } = {}
): SignificanceResult {
  const seed = opts.seed ?? 42;

  const baselineMean =
    baselineValues.reduce((s, v) => s + v, 0) / baselineValues.length || 0;
  const experimentMean =
    experimentValues.reduce((s, v) => s + v, 0) / experimentValues.length || 0;
  const delta = experimentMean - baselineMean;

  // Bootstrap CI on the delta
  const n = Math.min(baselineValues.length, experimentValues.length);
  const diffs = baselineValues.slice(0, n).map((v, i) => experimentValues[i] - v);
  const ci95 = bootstrapCI(diffs, (s) => s.reduce((a, b) => a + b, 0) / s.length, {
    seed,
  });

  // Paired permutation test
  const pValue = pairedPermutationTest(experimentValues, baselineValues, { seed });

  // Effect size
  const effectSize = cohensD(experimentValues, baselineValues);

  return {
    metricName,
    baseline: baselineMean,
    experiment: experimentMean,
    delta,
    ci95,
    pValue,
    effectSize,
    significant: pValue < 0.05 && Math.abs(effectSize) > 0.2,
  };
}

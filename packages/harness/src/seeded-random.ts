/**
 * Seeded PRNG for deterministic test runs.
 * Uses xoshiro128** with splitmix32 initialization.
 */

/**
 * Create a seeded random number generator.
 * Returns a function that produces uniform [0, 1) values.
 */
export function createSeededRandom(seed: number): () => number {
  // Initialize 128-bit state from seed using splitmix32
  let s = seed | 0;
  const splitmix32 = () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };

  let a = splitmix32();
  let b = splitmix32();
  let c = splitmix32();
  let d = splitmix32();

  // xoshiro128** — fast, high-quality 128-bit state PRNG
  return function xoshiro128ss(): number {
    const t = b << 9;
    let r = a * 5;
    r = ((r << 7) | (r >>> 25)) * 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = (d << 11) | (d >>> 21);
    return (r >>> 0) / 4294967296;
  };
}

/**
 * Monkey-patch Math.random with a seeded PRNG.
 * Returns a restore function that puts back the original Math.random.
 */
export function patchMathRandom(seed: number): () => void {
  const originalRandom = Math.random;
  Math.random = createSeededRandom(seed);
  return () => {
    Math.random = originalRandom;
  };
}

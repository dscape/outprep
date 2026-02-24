/**
 * Consistent color palette for chart runs.
 * Each loaded run gets a unique color from this palette.
 */
const PALETTE = [
  "#3b82f6", // blue-500
  "#ef4444", // red-500
  "#22c55e", // green-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#06b6d4", // cyan-500
  "#ec4899", // pink-500
  "#f97316", // orange-500
];

export function getRunColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export { PALETTE };

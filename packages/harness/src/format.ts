/**
 * CLI output formatting — tables, progress bars, and comparisons.
 */

import type { Metrics, TestResult } from "./types";

// ── Progress bar ────────────────────────────────────────────────────

export function progressBar(
  current: number,
  total: number,
  width = 40
): string {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(pct * width);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
  return `[${bar}] ${current}/${total} (${(pct * 100).toFixed(1)}%)`;
}

// ── Metrics summary table ───────────────────────────────────────────

export function formatMetrics(m: Metrics): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("  Overall Metrics");
  lines.push("  " + "\u2500".repeat(50));
  lines.push(`  Positions evaluated:  ${m.totalPositions}`);
  lines.push(`  Move match rate:      ${(m.matchRate * 100).toFixed(1)}%`);
  lines.push(`  Top-4 accuracy:       ${(m.topNRate * 100).toFixed(1)}%`);
  lines.push(`  Book coverage:        ${(m.bookCoverage * 100).toFixed(1)}%`);
  lines.push(`  Avg actual CPL:       ${m.avgActualCPL.toFixed(1)}`);
  lines.push(`  Avg bot CPL:          ${m.avgBotCPL.toFixed(1)}`);
  lines.push(`  CPL delta:            ${m.cplDelta.toFixed(1)}`);
  lines.push("");
  lines.push("  Phase Breakdown");
  lines.push("  " + "\u2500".repeat(50));
  lines.push(
    "  Phase        Positions  Match%  Top4%  aCPL   bCPL"
  );

  for (const phase of ["opening", "middlegame", "endgame"] as const) {
    const p = m.byPhase[phase];
    lines.push(
      `  ${phase.padEnd(12)} ${String(p.positions).padStart(9)}  ${(p.matchRate * 100).toFixed(1).padStart(5)}%  ${(p.topNRate * 100).toFixed(1).padStart(4)}%  ${p.avgCPL.toFixed(1).padStart(5)}  ${p.botAvgCPL.toFixed(1).padStart(5)}`
    );
  }
  lines.push("");

  return lines.join("\n");
}

// ── Comparison table ────────────────────────────────────────────────

export function formatComparison(results: TestResult[]): string {
  if (results.length === 0) return "No results to compare.";

  const lines: string[] = [];
  lines.push("");
  lines.push("  Run Comparison");
  lines.push("  " + "\u2500".repeat(80));

  // Header
  const header = ["Label", "Elo", "Commit", "Match%", "Top4%", "Book%", "aCPL", "bCPL", "Delta"];
  const widths = [16, 6, 9, 7, 6, 6, 6, 6, 6];
  lines.push(
    "  " +
      header.map((h, i) => h.padStart(widths[i])).join("  ")
  );
  lines.push("  " + "\u2500".repeat(80));

  for (const r of results) {
    const m = r.metrics;
    const commitStr = r.version
      ? `${r.version.gitCommit}${r.version.gitDirty ? "*" : ""}`
      : "n/a";
    const row = [
      (r.label || "unnamed").slice(0, 16).padEnd(16),
      String(r.elo).padStart(6),
      commitStr.padStart(9),
      (m.matchRate * 100).toFixed(1).padStart(7),
      (m.topNRate * 100).toFixed(1).padStart(6),
      (m.bookCoverage * 100).toFixed(1).padStart(6),
      m.avgActualCPL.toFixed(1).padStart(6),
      m.avgBotCPL.toFixed(1).padStart(6),
      m.cplDelta.toFixed(1).padStart(6),
    ];
    lines.push("  " + row.join("  "));
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Prompt builder — constructs Claude API prompts from experiment data.
 *
 * The prompt includes baseline metrics, all experiment results,
 * and historical context so Claude can make informed recommendations.
 */

import type { BotConfig } from "@outprep/engine";
import type { AggregatedResult, CycleRecord } from "../state/types";
import { formatStrength } from "../scoring/composite-score";

function formatMetricsRow(label: string, r: AggregatedResult): string {
  const m = r.aggregatedMetrics;
  return [
    label.padEnd(40),
    (m.matchRate * 100).toFixed(1).padStart(7) + "%",
    (m.topNRate * 100).toFixed(1).padStart(7) + "%",
    (m.bookCoverage * 100).toFixed(1).padStart(7) + "%",
    m.avgActualCPL.toFixed(1).padStart(7),
    m.avgBotCPL.toFixed(1).padStart(7),
    m.cplDelta.toFixed(1).padStart(7),
    (r.compositeScore * 100).toFixed(2).padStart(8) + "%",
    (r.scoreDelta >= 0 ? "+" : "") + (r.scoreDelta * 100).toFixed(2).padStart(7) + "%",
  ].join("  ");
}

function formatExperimentsTable(
  baseline: AggregatedResult,
  experiments: AggregatedResult[]
): string {
  const header = [
    "Experiment".padEnd(40),
    "Match%".padStart(8),
    "Top4%".padStart(8),
    "Book%".padStart(8),
    "aCPL".padStart(8),
    "bCPL".padStart(8),
    "Delta".padStart(8),
    "Score".padStart(9),
    "Δ Score".padStart(9),
  ].join("  ");

  const separator = "─".repeat(header.length);

  const rows = [
    header,
    separator,
    formatMetricsRow("BASELINE", baseline),
    separator,
    ...experiments
      .sort((a, b) => b.scoreDelta - a.scoreDelta)
      .map((exp) => formatMetricsRow(exp.description.slice(0, 40), exp)),
  ];

  return rows.join("\n");
}

function formatHistory(history: CycleRecord[]): string {
  if (history.length === 0) return "This is the first tuning cycle.";

  const recent = history.slice(-5); // Last 5 cycles

  const cycleLines = recent.map((c) => {
    const baselineStr = c.baselineScore != null
      ? `baseline=${(c.baselineScore * 100).toFixed(2)}%`
      : "baseline=unknown";
    let line =
      `Cycle ${c.cycle}: ${c.accepted ? "ACCEPTED" : "REJECTED"} — ` +
      `${baselineStr}, ${c.experimentsRun} experiments, best Δ = ${(c.bestScoreDelta * 100).toFixed(2)}%`;

    if (c.configChanges.length > 0) {
      const changeDetails = c.configChanges.map((ch) =>
        `${ch.path}: ${JSON.stringify(ch.oldValue)} → ${JSON.stringify(ch.newValue)} (${(ch.scoreDelta >= 0 ? "+" : "")}${(ch.scoreDelta * 100).toFixed(2)}%)`
      );
      line += "\n  Changes:\n" + changeDetails.map((d) => `    - ${d}`).join("\n");
    }

    return line;
  });

  // Score trajectory line
  const scores = recent
    .filter((c) => c.baselineScore != null)
    .map((c) => `${(c.baselineScore! * 100).toFixed(2)}%`);
  const trajectory = scores.length > 0
    ? `\nScore trajectory: ${scores.join(" → ")} → current`
    : "";

  return cycleLines.join("\n\n") + trajectory;
}

/**
 * Build the analysis prompt for Claude.
 */
export function buildAnalysisPrompt(
  bestConfig: BotConfig,
  baseline: AggregatedResult,
  experiments: AggregatedResult[],
  history: CycleRecord[]
): string {
  const improving = experiments.filter((e) => e.scoreDelta > 0);
  const declining = experiments.filter((e) => e.scoreDelta < 0);

  return `You are an expert chess engine tuner for the Outprep bot platform. Your goal is to optimize a chess bot so it mimics real human play as closely as possible.

## Current Best Config
\`\`\`json
${JSON.stringify(bestConfig, null, 2)}
\`\`\`

## How the Bot Works
- Elo → skill level (0-20) via linear mapping
- Each position: opening trie lookup → or Stockfish MultiPV → Boltzmann sampling
- Temperature = max(floor, (20 - dynamicSkill) × temperatureScale)
- Dynamic skill adjusts per game phase based on player error profile
- Higher temperature = more random (worse) moves; lower = more deterministic (better)

## Baseline Metrics (aggregated across ${baseline.datasetMetrics.length} datasets)
${formatMetricsRow("BASELINE", baseline)}

## Baseline Strength Calibration
${baseline.datasetMetrics
  .sort((a, b) => a.elo - b.elo)
  .map(
    (dm) =>
      `  ${dm.dataset} (Elo ${dm.elo}): botCPL=${dm.metrics.avgBotCPL.toFixed(1)} playerCPL=${dm.metrics.avgActualCPL.toFixed(1)} → ${formatStrength(dm.metrics.avgActualCPL, dm.metrics.avgBotCPL)}`
  )
  .join("\n")}

## All Experiment Results
${formatExperimentsTable(baseline, experiments)}

## Summary
- ${improving.length} experiments improved over baseline
- ${declining.length} experiments declined
- Best improvement: ${improving.length > 0 ? improving.sort((a, b) => b.scoreDelta - a.scoreDelta)[0].description + " (+" + (improving[0].scoreDelta * 100).toFixed(2) + "%)" : "none"}

## Historical Context
${formatHistory(history)}

## Per-Band Breakdown of Top 5 Experiments
${experiments
  .sort((a, b) => b.scoreDelta - a.scoreDelta)
  .slice(0, 5)
  .map(
    (exp) =>
      `### ${exp.description}\n` +
      exp.datasetMetrics
        .map(
          (dm) =>
            `  ${dm.dataset} (Elo ${dm.elo}): match=${(dm.metrics.matchRate * 100).toFixed(1)}% top4=${(dm.metrics.topNRate * 100).toFixed(1)}% cplΔ=${dm.metrics.cplDelta.toFixed(1)} → ${formatStrength(dm.metrics.avgActualCPL, dm.metrics.avgBotCPL)}`
        )
        .join("\n")
  )
  .join("\n\n")}

## Your Task
Analyze these results and produce a JSON response wrapped in \`\`\`json\`\`\` fences with this structure:
{
  "summary": "2-3 sentence overview of findings",
  "rankedChanges": [
    {
      "path": "boltzmann.temperatureScale",
      "newValue": 12,
      "scoreDelta": 0.032,
      "reasoning": "why this helps"
    }
  ],
  "proposedConfig": { /* full BotConfig with recommended changes applied */ },
  "codeProposals": [
    "Brief description of a code-level improvement worth investigating"
  ],
  "nextPriorities": [
    "What parameters to focus on in the next cycle"
  ],
  "warnings": [
    "Any Elo-band-specific effects or risks from combining changes"
  ]
}

Guidelines:
1. Only include changes that showed clear improvement (positive score delta).
2. Be conservative when combining changes — flag interaction risks.
3. If no experiments improved, say so and suggest different perturbation ranges.
4. Consider Elo-band-specific effects: a change that helps experts but hurts beginners may not be worth it.
5. For code proposals, suggest specific engine changes (e.g., per-phase temperature, material-weighted scoring).
6. IMPORTANT: Prefer proposing ONE high-confidence change per cycle over multiple simultaneous changes. Changing multiple parameters at once makes it impossible to isolate which change caused improvements or regressions. Only combine changes when they are clearly independent (e.g., opening trie + endgame depth).
7. Use the historical baseline scores to assess whether the tuning trajectory is improving overall. If scores have plateaued or regressed, consider reverting recent changes or trying a different approach.
8. Pay special attention to strength calibration per Elo band. If the bot is "too strong" for low-Elo players or "too weak" for high-Elo players, prioritize parameters that control skill mapping (dynamicSkill, depthBySkill, temperatureScale).`;
}

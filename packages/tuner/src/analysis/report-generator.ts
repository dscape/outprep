/**
 * Report generator — parses Claude's analysis response and produces
 * proposal.md and proposal.json files.
 *
 * Also supports a fallback mode that generates a purely statistical
 * report when no API key is available.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { BotConfig } from "@outprep/engine";
import type { AggregatedResult, Proposal, ConfigChange } from "../state/types";
import { formatScore, formatDelta, formatStrength } from "../scoring/composite-score";
import { getConfigValue } from "../util/parameter-registry";
import { getTunerRoot } from "../state/tuner-state";

interface ClaudeAnalysis {
  summary: string;
  rankedChanges: {
    path: string;
    newValue: unknown;
    scoreDelta: number;
    reasoning: string;
  }[];
  proposedConfig: BotConfig;
  codeProposals: string[];
  nextPriorities: string[];
  warnings: string[];
}

/**
 * Parse Claude's JSON response from the analysis.
 */
export function parseClaudeResponse(text: string): ClaudeAnalysis | null {
  // Extract JSON block from markdown fences
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) {
    console.error("  Could not find JSON block in Claude response.");
    return null;
  }

  try {
    return JSON.parse(jsonMatch[1]) as ClaudeAnalysis;
  } catch (err) {
    console.error("  Failed to parse Claude JSON:", err);
    return null;
  }
}

/**
 * Generate a proposal from Claude's analysis or from raw statistics.
 */
export function generateProposal(
  cycle: number,
  bestConfig: BotConfig,
  baseline: AggregatedResult,
  experiments: AggregatedResult[],
  analysis: ClaudeAnalysis | null,
  regressionSummary?: string
): Proposal {
  const improving = experiments
    .filter((e) => e.scoreDelta > 0)
    .sort((a, b) => b.scoreDelta - a.scoreDelta);

  // Build config changes from analysis or from top experiments
  let configChanges: ConfigChange[];
  let proposedConfig: BotConfig;
  let summary: string;
  let codeProposals: string[];
  let nextPriorities: string[];

  if (analysis) {
    // Use Claude's analysis — filter out no-op changes (e.g., influence: 0 → 0)
    configChanges = analysis.rankedChanges
      .map((change) => ({
        path: change.path,
        oldValue: getConfigValue(bestConfig, change.path),
        newValue: change.newValue,
        scoreDelta: change.scoreDelta,
        description: change.reasoning,
      }))
      .filter((change) => JSON.stringify(change.oldValue) !== JSON.stringify(change.newValue));
    proposedConfig = analysis.proposedConfig;
    summary = analysis.summary;
    codeProposals = analysis.codeProposals;
    nextPriorities = analysis.nextPriorities;
  } else {
    // Statistical fallback — filter out no-op changes
    configChanges = improving.slice(0, 5).map((exp) => {
      const path = exp.parameter;
      return {
        path,
        oldValue: getConfigValue(bestConfig, path),
        newValue: getFirstOverrideValue(exp.configOverride),
        scoreDelta: exp.scoreDelta,
        description: exp.description,
      };
    }).filter((change) => JSON.stringify(change.oldValue) !== JSON.stringify(change.newValue));
    proposedConfig = bestConfig; // Can't auto-combine without AI
    summary =
      improving.length > 0
        ? `Found ${improving.length} improving experiment(s). Best: ${improving[0].description} (${formatDelta(improving[0].scoreDelta)}).`
        : "No experiments improved over baseline. Consider widening perturbation ranges or adding new parameters.";
    codeProposals = [];
    nextPriorities = improving.length > 0
      ? [`Continue exploring ${improving[0].parameter} with finer granularity`]
      : ["Try larger perturbation ranges", "Consider new tunable parameters"];
  }

  return {
    cycle,
    timestamp: new Date().toISOString(),
    baselineScore: baseline.compositeScore,
    baselineMetrics: baseline.aggregatedMetrics,
    baselineDatasetMetrics: baseline.datasetMetrics,
    rankedExperiments: improving,
    proposedConfig,
    configChanges,
    summary,
    codeProposals,
    nextPriorities,
    usedClaudeAnalysis: !!analysis,
    regressionSummary,
  };
}

function getFirstOverrideValue(override: Record<string, unknown>): unknown {
  for (const key of Object.keys(override)) {
    const val = override[key];
    if (val != null && typeof val === "object" && !Array.isArray(val)) {
      // Nested object — get first nested value
      const inner = val as Record<string, unknown>;
      for (const innerKey of Object.keys(inner)) {
        return inner[innerKey];
      }
    }
    return val;
  }
  return undefined;
}

/**
 * Write proposal files to disk.
 */
export function writeProposal(proposal: Proposal): string {
  const timestamp = proposal.timestamp.replace(/[:.]/g, "-").slice(0, 19);
  const proposalDir = join(getTunerRoot(), "proposals", timestamp);

  if (!existsSync(proposalDir)) mkdirSync(proposalDir, { recursive: true });

  // Write JSON
  const jsonPath = join(proposalDir, "proposal.json");
  writeFileSync(jsonPath, JSON.stringify(proposal, null, 2) + "\n");

  // Write markdown
  const mdPath = join(proposalDir, "proposal.md");
  writeFileSync(mdPath, generateMarkdown(proposal));

  return proposalDir;
}

function generateMarkdown(proposal: Proposal): string {
  const lines: string[] = [
    `# Tuner Report — Cycle ${proposal.cycle}`,
    ``,
    `**Generated:** ${new Date(proposal.timestamp).toLocaleString()}`,
    `**Baseline Score:** ${formatScore(proposal.baselineScore)}`,
    ``,
  ];

  // Baseline metric breakdown
  if (proposal.baselineMetrics) {
    const m = proposal.baselineMetrics;
    lines.push(
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Match Rate | ${(m.matchRate * 100).toFixed(1)}% |`,
      `| Top-4 Rate | ${(m.topNRate * 100).toFixed(1)}% |`,
      `| CPL Delta | ${isNaN(m.cplDelta) ? "N/A" : m.cplDelta.toFixed(1)} |`,
      `| Avg Bot CPL | ${isNaN(m.avgBotCPL) ? "N/A" : m.avgBotCPL.toFixed(1)} |`,
      `| Avg Actual CPL | ${isNaN(m.avgActualCPL) ? "N/A" : m.avgActualCPL.toFixed(1)} |`,
      `| Book Coverage | ${(m.bookCoverage * 100).toFixed(1)}% |`,
      ``,
    );
  }

  // Strength calibration per dataset
  if (proposal.baselineDatasetMetrics && proposal.baselineDatasetMetrics.length > 0) {
    const sorted = [...proposal.baselineDatasetMetrics].sort((a, b) => a.elo - b.elo);
    lines.push(
      `## Strength Calibration`,
      ``,
      `| Player | Elo | Bot CPL | Player CPL | Status |`,
      `|--------|-----|---------|------------|--------|`,
    );
    for (const dm of sorted) {
      const bCPL = isNaN(dm.metrics.avgBotCPL) ? "N/A" : dm.metrics.avgBotCPL.toFixed(1);
      const aCPL = isNaN(dm.metrics.avgActualCPL) ? "N/A" : dm.metrics.avgActualCPL.toFixed(1);
      lines.push(
        `| ${dm.dataset} | ${dm.elo} | ${bCPL} | ${aCPL} | ${formatStrength(dm.metrics.avgActualCPL, dm.metrics.avgBotCPL)} |`
      );
    }
    lines.push(``);
  }

  if (!proposal.usedClaudeAnalysis) {
    lines.push(
      `> **Note:** This report was generated WITHOUT Claude analysis (API unavailable).`,
      `> Re-run with a valid ANTHROPIC_API_KEY for AI-powered insights.`,
      ``,
    );
  }

  lines.push(
    `## Summary`,
    ``,
    proposal.summary,
    ``,
  );

  if (proposal.regressionSummary) {
    lines.push(
      `## Regression Check`,
      ``,
      proposal.regressionSummary,
      ``,
    );
  }

  if (proposal.configChanges.length > 0) {
    lines.push(`## Recommended Changes`, ``);
    for (let i = 0; i < proposal.configChanges.length; i++) {
      const change = proposal.configChanges[i];
      lines.push(
        `${i + 1}. **\`${change.path}\`**: \`${JSON.stringify(change.oldValue)}\` → \`${JSON.stringify(change.newValue)}\` (${formatDelta(change.scoreDelta)})`,
        `   ${change.description}`,
        ``
      );
    }
  }

  if (proposal.rankedExperiments.length > 0) {
    lines.push(`## Top Experiments`, ``);
    lines.push(`| Experiment | Match% | Top4% | CPL Δ | Score | Δ Score |`);
    lines.push(`|------------|--------|-------|-------|-------|---------|`);
    for (const exp of proposal.rankedExperiments.slice(0, 10)) {
      const m = exp.aggregatedMetrics;
      const cplStr = isNaN(m.cplDelta) ? "N/A" : m.cplDelta.toFixed(1);
      lines.push(
        `| ${exp.description.slice(0, 35)} | ${(m.matchRate * 100).toFixed(1)}% | ${(m.topNRate * 100).toFixed(1)}% | ${cplStr} | ${formatScore(exp.compositeScore)} | ${formatDelta(exp.scoreDelta)} |`
      );
    }
    lines.push(``);
  }

  if (proposal.codeProposals.length > 0) {
    lines.push(`## Code Improvement Suggestions`, ``);
    for (const cp of proposal.codeProposals) {
      lines.push(`- ${cp}`);
    }
    lines.push(``);
  }

  if (proposal.nextPriorities.length > 0) {
    lines.push(`## Next Priorities`, ``);
    for (const np of proposal.nextPriorities) {
      lines.push(`- ${np}`);
    }
    lines.push(``);
  }

  lines.push(
    `## Next Steps`,
    ``,
    `- **Accept changes:** \`npm run tuner -- accept\``,
    `- **Reject and continue:** \`npm run tuner -- reject\``,
    `- **View full details:** See \`proposal.json\` in this directory`,
    ``
  );

  return lines.join("\n");
}

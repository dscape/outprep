/**
 * Markdown log generation for research experiments.
 *
 * Produces structured markdown files following the Witanlabs
 * research-log format: hypothesis → changes → results → conclusion.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExperimentRecord, SignificanceResult } from "../state/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORGE_ROOT = join(__dirname, "..", "..");
const LOGS_DIR = join(FORGE_ROOT, "logs");

/**
 * Write an experiment log as a markdown file.
 */
export function writeExperimentLog(
  sessionName: string,
  experiment: ExperimentRecord
): string {
  const sessionDir = join(LOGS_DIR, sessionName);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }

  const filename = `${String(experiment.number).padStart(3, "0")}-${slugify(experiment.hypothesis.slice(0, 50))}.md`;
  const filepath = join(sessionDir, filename);
  const content = formatExperiment(sessionName, experiment);

  writeFileSync(filepath, content);
  return filepath;
}

/**
 * Format an experiment record as markdown.
 */
function formatExperiment(
  sessionName: string,
  exp: ExperimentRecord
): string {
  const conclusionLabel = {
    confirmed: "CONFIRMED",
    refuted: "REFUTED",
    partial: "PARTIALLY CONFIRMED",
    inconclusive: "INCONCLUSIVE",
  }[exp.conclusion];

  const lines: string[] = [];

  // Header
  lines.push(`# Experiment ${exp.number}: ${truncate(exp.hypothesis, 80)}`);
  lines.push("");
  lines.push(
    `**Session**: ${sessionName} | **Date**: ${exp.timestamp.split("T")[0]} | **Status**: ${conclusionLabel}`
  );
  lines.push("");

  // Hypothesis
  lines.push("## Hypothesis");
  lines.push("");
  lines.push(exp.hypothesis);
  lines.push("");

  // Changes
  if (exp.codeChanges.length > 0 || exp.configChanges.length > 0) {
    lines.push("## Changes");
    lines.push("");

    for (const change of exp.codeChanges) {
      lines.push(`### Code: \`${change.file}\``);
      lines.push("");
      lines.push("```diff");
      lines.push(change.diff);
      lines.push("```");
      lines.push("");
    }

    if (exp.configChanges.length > 0) {
      lines.push("### Config");
      lines.push("");
      for (const change of exp.configChanges) {
        lines.push(
          `- \`${change.path}\`: \`${JSON.stringify(change.oldValue)}\` → \`${JSON.stringify(change.newValue)}\``
        );
      }
      lines.push("");
    }
  }

  // Results
  lines.push("## Results");
  lines.push("");
  lines.push(
    `Evaluated ${exp.positionsEvaluated} positions across ${exp.players.length} player(s) in ${(exp.evaluationDurationMs / 1000).toFixed(1)}s.`
  );
  lines.push("");

  // Significance table
  if (exp.significance.length > 0) {
    lines.push(
      "| Metric | Baseline | Experiment | Delta | p-value | Sig? |"
    );
    lines.push("|--------|----------|------------|-------|---------|------|");

    for (const sig of exp.significance) {
      lines.push(formatSignificanceRow(sig));
    }
    lines.push("");
  }

  // Summary metrics
  lines.push("### Key Metrics");
  lines.push("");
  lines.push(
    `- **Move Accuracy**: ${(exp.result.moveAccuracy * 100).toFixed(1)}% (Δ ${formatDelta(exp.delta.moveAccuracy * 100)}pp)`
  );
  lines.push(
    `- **CPL KL Div**: ${exp.result.cplKLDivergence.toFixed(4)} (Δ ${formatDelta(exp.delta.cplKLDivergence, 4)})`
  );
  lines.push(
    `- **Blunder Δ**: ${exp.result.blunderRateDelta.overall.toFixed(4)} (Δ ${formatDelta(exp.delta.blunderRateDelta, 4)})`
  );
  lines.push(
    `- **Composite**: ${exp.result.compositeScore.toFixed(4)} (Δ ${formatDelta(exp.delta.compositeScore, 4)})`
  );
  lines.push("");

  // Per-phase breakdown
  lines.push("### Per-Phase Accuracy");
  lines.push("");
  lines.push("| Phase | Accuracy | Blunder Rate Δ |");
  lines.push("|-------|----------|----------------|");
  for (const phase of ["opening", "middlegame", "endgame"] as const) {
    lines.push(
      `| ${phase} | ${(exp.result.moveAccuracyByPhase[phase] * 100).toFixed(1)}% | ${exp.result.blunderRateDelta[phase].toFixed(4)} |`
    );
  }
  lines.push("");

  // Conclusion
  lines.push("## Conclusion");
  lines.push("");
  lines.push(`**${conclusionLabel}.** ${exp.notes}`);
  lines.push("");

  // Next steps
  if (exp.nextSteps.length > 0) {
    lines.push("## Next Steps");
    lines.push("");
    for (let i = 0; i < exp.nextSteps.length; i++) {
      lines.push(`${i + 1}. ${exp.nextSteps[i]}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatSignificanceRow(sig: SignificanceResult): string {
  const baseStr = formatMetricValue(sig.metricName, sig.baseline);
  const expStr = formatMetricValue(sig.metricName, sig.experiment);
  const deltaStr = formatDelta(sig.delta, 4);
  const pStr = sig.pValue < 0.001 ? "<0.001" : sig.pValue.toFixed(3);
  const sigStr = sig.significant ? "**Yes**" : "No";

  return `| ${sig.metricName} | ${baseStr} | ${expStr} | ${deltaStr} | ${pStr} | ${sigStr} |`;
}

function formatMetricValue(name: string, value: number): string {
  if (name.toLowerCase().includes("accuracy") || name.toLowerCase().includes("rate")) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toFixed(4);
}

function formatDelta(value: number, decimals = 1): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

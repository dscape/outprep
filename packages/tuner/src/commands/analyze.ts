/**
 * Analyze command — use Claude API to synthesize sweep results
 * and generate a proposal for human review.
 *
 * Falls back to statistical analysis if ANTHROPIC_API_KEY is not set.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { getOrCreateState, saveState, getTunerRoot } from "../state/tuner-state";
import { buildAnalysisPrompt } from "../analysis/prompt-builder";
import {
  parseClaudeResponse,
  generateProposal,
  writeProposal,
} from "../analysis/report-generator";
import { formatStrength } from "../scoring/composite-score";
import {
  runRegressionCheck,
  printRegressionReport,
  formatRegressionForPrompt,
} from "../analysis/regression-check";
import type { RegressionReport } from "../analysis/regression-check";
import type { AggregatedResult } from "../state/types";
import { sanitizeAggregatedResult } from "../util/nan-safe";

export async function analyze() {
  const state = getOrCreateState();

  // Find the most recent sweep results
  const resultsDir = join(getTunerRoot(), "experiments", "results");
  if (!existsSync(resultsDir)) {
    console.error("\n  No sweep results found. Run `npm run tuner -- sweep` first.\n");
    return;
  }

  const files = readdirSync(resultsDir)
    .filter((f) => f.startsWith("sweep-cycle-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error("\n  No sweep results found. Run `npm run tuner -- sweep` first.\n");
    return;
  }

  const latestPath = join(resultsDir, files[0]);
  console.log(`\n  Loading sweep results: ${files[0]}`);

  const sweepData = JSON.parse(readFileSync(latestPath, "utf-8")) as {
    baseline: AggregatedResult;
    experiments: AggregatedResult[];
  };

  // Sanitize NaN fields that became null during JSON round-trip
  sanitizeAggregatedResult(sweepData.baseline);
  for (const exp of sweepData.experiments) {
    sanitizeAggregatedResult(exp);
  }

  // Load all historical sweep results for metrics progression
  const allSweepFiles = [...files].reverse(); // chronological order (oldest first)
  const historicalBaselines: { cycle: number; baseline: AggregatedResult }[] = [];

  for (const file of allSweepFiles) {
    // Skip the current (latest) file — it's already the baseline
    if (file === files[0]) continue;
    const match = file.match(/sweep-cycle-(\d+)\.json/);
    if (!match) continue;
    try {
      const cycleNum = parseInt(match[1], 10);
      const data = JSON.parse(readFileSync(join(resultsDir, file), "utf-8")) as {
        baseline: AggregatedResult;
      };
      sanitizeAggregatedResult(data.baseline);
      historicalBaselines.push({ cycle: cycleNum, baseline: data.baseline });
    } catch {
      // Skip corrupt/unreadable files
    }
  }

  // ── Regression Check (before Claude analysis) ──────────
  let regressionReport: RegressionReport | null = null;
  let regressionSummary: string | undefined;

  if (historicalBaselines.length > 0) {
    const prev = historicalBaselines[historicalBaselines.length - 1];
    regressionReport = runRegressionCheck(
      sweepData.baseline,
      prev.baseline,
      state.cycle,
      prev.cycle,
      state.completedCycles,
      historicalBaselines
    );
    printRegressionReport(regressionReport);
    regressionSummary = formatRegressionForPrompt(regressionReport);
  } else {
    console.log("\n  No previous cycle — skipping regression check.\n");
  }

  state.phase = "analyze";
  saveState(state);

  console.log("\n  ╔══════════════════════════════════════════╗");
  console.log("  ║          Analyzing Results               ║");
  console.log("  ╚══════════════════════════════════════════╝\n");

  console.log(`  Baseline score: ${(sweepData.baseline.compositeScore * 100).toFixed(2)}%`);
  const bm = sweepData.baseline.aggregatedMetrics;
  const analyzeCplStr = isNaN(bm.cplDelta) ? "N/A" : bm.cplDelta.toFixed(1);
  console.log(
    `  Breakdown:      match=${(bm.matchRate * 100).toFixed(1)}%  top4=${(bm.topNRate * 100).toFixed(1)}%  cplΔ=${analyzeCplStr}  book=${(bm.bookCoverage * 100).toFixed(1)}%  strength: ${formatStrength(bm.avgActualCPL, bm.avgBotCPL)}`
  );
  console.log(`  Experiments:    ${sweepData.experiments.length}`);
  console.log(`  Improving:      ${sweepData.experiments.filter((e) => e.scoreDelta > 0).length}\n`);

  // Claude API analysis (ANTHROPIC_API_KEY is guaranteed by CLI preAction hook)
  let claudeAnalysis = null;
  const apiKey = process.env.ANTHROPIC_API_KEY!;

  console.log("  Using Claude API for analysis...\n");

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });

    const prompt = buildAnalysisPrompt(
      state.bestConfig,
      sweepData.baseline,
      sweepData.experiments,
      state.completedCycles,
      historicalBaselines,
      regressionReport
    );

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    claudeAnalysis = parseClaudeResponse(text);

    if (claudeAnalysis) {
      console.log("  Claude analysis complete.\n");
      console.log(`  Summary: ${claudeAnalysis.summary}\n`);
    } else {
      console.log("  Could not parse Claude response. Falling back to statistical analysis.\n");
    }
  } catch (err) {
    console.error("\n  ╔══════════════════════════════════════════╗");
    console.error("  ║  ⚠ Claude API call FAILED               ║");
    console.error("  ╚══════════════════════════════════════════╝\n");
    console.error(`  Error: ${err}\n`);
    console.error("  Check that ANTHROPIC_API_KEY is set correctly.");
    console.error("  You can create packages/tuner/.env with:");
    console.error("    ANTHROPIC_API_KEY=sk-ant-...\n");
    console.log("  Falling back to statistical analysis (no AI insights).\n");
  }

  // Generate proposal
  const proposal = generateProposal(
    state.cycle,
    state.bestConfig,
    sweepData.baseline,
    sweepData.experiments,
    claudeAnalysis,
    regressionSummary
  );

  const proposalDir = writeProposal(proposal);

  state.phase = "waiting";
  saveState(state);

  console.log(`  ── Proposal Generated ──\n`);
  console.log(`  ${proposal.summary}\n`);

  if (proposal.configChanges.length > 0) {
    console.log(`  Recommended changes:`);
    for (const change of proposal.configChanges.slice(0, 5)) {
      const sign = change.scoreDelta >= 0 ? "+" : "";
      console.log(
        `    ${change.path}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)} (${sign}${(change.scoreDelta * 100).toFixed(2)}%)`
      );
    }
    console.log();
  }

  if (proposal.codeProposals.length > 0) {
    console.log(`  Code suggestions:`);
    for (const cp of proposal.codeProposals) {
      console.log(`    • ${cp}`);
    }
    console.log();
  }

  console.log(`  Full report: ${proposalDir}/proposal.md`);
  console.log();
  console.log(`  Next steps:`);
  console.log(`    npm run tuner -- accept     Accept changes and update DEFAULT_CONFIG`);
  console.log(`    npm run tuner -- reject     Reject and archive this proposal`);
  console.log();
}

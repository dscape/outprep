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
import type { AggregatedResult } from "../state/types";

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

  state.phase = "analyze";
  saveState(state);

  console.log("\n  ╔══════════════════════════════════════════╗");
  console.log("  ║          Analyzing Results               ║");
  console.log("  ╚══════════════════════════════════════════╝\n");

  console.log(`  Baseline score: ${(sweepData.baseline.compositeScore * 100).toFixed(2)}%`);
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
      state.completedCycles
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
    claudeAnalysis
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

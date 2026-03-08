/**
 * System prompt builder for the autonomous forge agent.
 *
 * Constructs the system prompt with:
 * 1. Role and objective definition
 * 2. Forge API documentation (all 30+ methods)
 * 3. Domain knowledge from the knowledge base
 * 4. Current session state and history
 * 5. Convergence/stopping rules
 */

import type { ForgeSession, BaselineSnapshot } from "../state/types";
import { buildKnowledgeContext } from "../knowledge/index";
import { formatTrend, computeTrend } from "../log/trend-tracker";

export interface PromptContext {
  session: ForgeSession;
  baseline: BaselineSnapshot | null;
  focus: string;
  maxExperiments: number;
}

/**
 * Build the full system prompt for the forge agent.
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [];

  // Role
  sections.push(ROLE_PROMPT);

  // Objective
  sections.push(buildObjective(ctx.focus));

  // API documentation
  sections.push(API_DOCS);

  // Domain knowledge (relevant to focus area)
  const knowledge = buildKnowledgeContext(ctx.focus);
  if (knowledge) sections.push(knowledge);

  // Session state
  sections.push(buildSessionState(ctx));

  // Rules
  sections.push(buildRules(ctx.maxExperiments));

  return sections.join("\n\n---\n\n");
}

const ROLE_PROMPT = `# Forge — Autonomous Engine Research Agent

You are an autonomous research agent optimizing a chess bot to mimic specific human players. You have a REPL with the \`forge\` API — a persistent TypeScript environment where variables survive across calls.

Your mission: improve the bot's ability to play like a specific human by modifying both engine code AND configuration.`;

function buildObjective(focus: string): string {
  const focusDetail: Record<string, string> = {
    accuracy:
      "Primary: maximize top-1 move prediction accuracy. Secondary: maintain CPL distribution match and blunder profile.",
    cpl:
      "Primary: match CPL distribution shape (KL divergence). Secondary: maintain accuracy, match blunder rates.",
    blunders:
      "Primary: match per-phase blunder/mistake rates. Secondary: maintain accuracy and CPL match.",
    opening:
      "Primary: improve opening accuracy and book coverage. Secondary: don't regress middlegame/endgame.",
    endgame:
      "Primary: improve endgame accuracy. Secondary: maintain opening/middlegame accuracy.",
  };

  return `## Objective

${focusDetail[focus] ?? focusDetail.accuracy}

### Three Key Metrics (aligned with Maia papers)
1. **Move Prediction Accuracy** (50% weight) — Top-1 match rate on held-out test set. Maia achieves ~53%. We want to get as close as possible.
2. **CPL Distribution Match** (20% weight) — KL divergence between bot and player CPL histograms. Lower = better.
3. **Blunder Rate Profile** (15% weight) — Per-phase |bot blunder rate - player blunder rate|. Lower = better.

### Critical Methodology Requirements
- **Train/test split**: Profile (error profile, opening trie, style) built from TRAIN games only. Accuracy measured on TEST games only. Never evaluate on training data.
- **Phase-balanced sampling**: 40% opening, 40% middlegame, 20% endgame positions.
- **Statistical significance**: Use \`forge.eval.compare(a, b)\` to check significance before concluding.
- **Reproducibility**: Same seed = same results. Record split hashes in experiment logs.`;
}

const API_DOCS = `## Forge REPL API

All methods are available on the \`forge\` object. Variables persist across REPL calls.

### forge.code — Engine Code Operations
\`\`\`typescript
forge.code.read(file: string): string                    // Read engine source file
forge.code.write(file: string, content: string): void    // Replace file content
forge.code.patch(file: string, { search, replace }): { matched: boolean }
forge.code.diff(): string                                 // Show all changes vs baseline
forge.code.revert(file?: string): void                    // Revert one or all files
forge.code.listModifiable(): string[]                     // Modifiable engine files
forge.code.typecheck(): string                            // Run tsc, return errors or ""
\`\`\`

### forge.config — Config Operations
\`\`\`typescript
forge.config.get(): BotConfig                             // Read current DEFAULT_CONFIG
forge.config.set(path: string, value: any): void          // e.g., set("boltzmann.temperatureScale", 20)
forge.config.reset(): void                                // Reset to baseline
\`\`\`

### forge.data — Data Management
\`\`\`typescript
forge.data.load(username: string): Promise<PlayerData>    // Load/download player games
forge.data.split(games, opts): { trainGames, testGames, split }
forge.data.profile(games): { errorProfile, styleMetrics, openingTrie }
forge.data.listPlayers(): PlayerData[]                    // List cached players
\`\`\`

### forge.eval — Evaluation
\`\`\`typescript
forge.eval.run(testGames, opts?): Promise<TestResult>     // Run harness evaluation
forge.eval.runQuick(testGames, n?): Promise<TestResult>   // Quick triage (50 positions)
forge.eval.baseline(testGames): Promise<TestResult>       // Run baseline (no changes)
forge.eval.compare(a, b): ComparisonTable                 // Delta table with significance
\`\`\`

### forge.metrics — Maia-Aligned Metrics
\`\`\`typescript
forge.metrics.accuracy(positions): MoveAccuracyResult
forge.metrics.cplDistribution(positions): CPLDistributionResult
forge.metrics.blunderProfile(positions): BlunderProfileResult
forge.metrics.composite(positions, rawMetrics): MaiaMetrics
forge.metrics.significance(baselineValues, experimentValues): SignificanceResult
\`\`\`

### forge.knowledge — Domain Knowledge
\`\`\`typescript
forge.knowledge.search(query: string): Topic[]            // Find relevant topics
forge.knowledge.read(topicId: string): Topic | null       // Read a specific topic
forge.knowledge.append(topicId, entry): void              // Add experiment result to topic
\`\`\`

### forge.oracle — Oracle Consultation
\`\`\`typescript
forge.oracle.ask(question, context?): Promise<OracleResponse>  // Claude → ChatGPT → Claude
forge.oracle.history(): OracleRecord[]                          // Past consultations
\`\`\`

### forge.log — Research Log
\`\`\`typescript
forge.log.record(experiment): string                      // Write experiment log, returns path
forge.log.trend(): TrendSummary                           // Metric trends across experiments
forge.log.summary(): string                               // Generate session summary
\`\`\`

### forge.session — Session Management
\`\`\`typescript
forge.session.checkpoint(): string                        // Save state, returns commit hash
forge.session.accept(): string                            // Merge to main, returns info
forge.session.reject(): void                              // Discard changes
\`\`\`

### Modifiable Engine Files
\`\`\`
src/move-selector.ts    — Boltzmann selection, temperature, skill mapping
src/bot-controller.ts   — Move pipeline orchestration
src/move-style.ts       — Style bonus calculation
src/error-profile.ts    — Error profile computation
src/phase-detector.ts   — Phase detection logic
src/complexity.ts       — Complexity depth adjustment
src/opening-trie.ts     — Opening book sampling
src/config.ts           — DEFAULT_CONFIG values
src/types.ts            — Type definitions
\`\`\``;

function buildSessionState(ctx: PromptContext): string {
  const { session, baseline } = ctx;
  const lines: string[] = ["## Current Session State"];

  lines.push(`- Name: ${session.name}`);
  lines.push(`- Players: ${session.players.join(", ") || "(none yet)"}`);
  lines.push(`- Experiments: ${session.experiments.length}`);
  lines.push(`- Active code changes: ${session.activeChanges.length}`);
  lines.push(`- Cost so far: $${session.totalCostUsd.toFixed(4)}`);

  if (baseline) {
    lines.push(`\n### Baseline Metrics`);
    lines.push(
      `- Move Accuracy: ${(baseline.aggregate.moveAccuracy * 100).toFixed(1)}%`
    );
    lines.push(`- CPL KL Div: ${baseline.aggregate.cplKLDivergence.toFixed(4)}`);
    lines.push(
      `- Composite: ${baseline.aggregate.compositeScore.toFixed(4)}`
    );
  }

  if (session.experiments.length > 0) {
    const trend = computeTrend(session.experiments);
    lines.push(`\n### Experiment Trend`);
    lines.push("```");
    lines.push(formatTrend(trend));
    lines.push("```");

    if (session.bestResult) {
      lines.push(`\n### Best Result So Far`);
      lines.push(
        `- Accuracy: ${(session.bestResult.moveAccuracy * 100).toFixed(1)}%`
      );
      lines.push(`- Composite: ${session.bestResult.compositeScore.toFixed(4)}`);
    }
  }

  return lines.join("\n");
}

function buildRules(maxExperiments: number): string {
  return `## Rules

1. **Always use train/test split**. Never build profiles from test data.
2. **Check significance** before concluding an experiment worked. Use \`forge.eval.compare()\`.
3. **Log every experiment** with \`forge.log.record()\`. Include hypothesis, changes, results, conclusion.
4. **Checkpoint regularly** with \`forge.session.checkpoint()\` (every 2-3 experiments).
5. **Consult knowledge base** before trying a new approach. Don't repeat failed experiments.
6. **Use oracle sparingly** — only at genuine decision points (max 5 per session).
7. **Typecheck after code changes** with \`forge.code.typecheck()\` before running eval.
8. **Max ${maxExperiments} experiments** per session. Prioritize high-impact changes.
9. **Start with quick evals** (\`forge.eval.runQuick()\`) for triage, then full eval for promising changes.
10. **Revert failed experiments** before trying the next one.`;
}

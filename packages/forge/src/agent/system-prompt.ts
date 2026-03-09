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

import type { ForgeSession, ForgeState, BaselineSnapshot } from "../state/types";
import { buildKnowledgeContext, buildNotesContext } from "../knowledge/index";
import { formatTrend, computeTrend } from "../log/trend-tracker";

export interface PromptContext {
  session: ForgeSession;
  state: ForgeState;
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

  // Inter-agent notes from previous sessions
  const notes = buildNotesContext(5);
  if (notes) sections.push(notes);

  // Past sessions summary
  const pastSessions = buildPastSessionsSummary(ctx.state, ctx.session.id);
  if (pastSessions) sections.push(pastSessions);

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

### Methodology
- **Train/test separation is automatic** — just pass \`playerData[username].testGames\` to eval methods.
- **Phase-balanced sampling**: 40% opening, 40% middlegame, 20% endgame.
- **Statistical significance**: Use \`forge.eval.compare(a, b)\` before concluding.
- **Reproducibility**: Same seed = same results.`;
}

const API_DOCS = `## Forge API

Globals: \`forge\`, \`playerData\`. No \`require\`/\`import\`. Use \`await\` for async calls. Vars persist across REPL calls.

\`playerData["username"]\` → { meta, games, trainGames, testGames, split } (pre-loaded, pre-split 80/20).
Do NOT call \`forge.data.load()\` for players already in \`playerData\`.
Train/test separation is automatic: eval methods auto-detect trainGames from playerData when you pass playerData[username].testGames.

forge.code: read(file) | write(file, content) | patch(file, {search,replace}) | diff() | revert(file?) | listModifiable() | typecheck()
forge.config: get() | set(path, value) | reset()
forge.data: load(username) | split(games, opts) | getGames(username) | listPlayers()
forge.eval: run(testGames, opts?) | runQuick(testGames, trainGames?, n?) | baseline(testGames, trainGames?) | compare(a, b)
forge.metrics: accuracy(positions) | cplDistribution(positions) | blunderProfile(positions) | composite(positions, rawMetrics) | significance(base, exp)
forge.knowledge: search(query) | read(topicId) | append(topicId, entry) | create({id, title, relevance, content}) | compact(topicId, keepRecent?) | archives(topicId)
forge.knowledge (notes): note(content, tags?) | notes({limit?, tags?}) | searchNotes(query)
forge.history: sessions({status?, player?}) | searchExperiments(query) | experiment(id)
forge.oracle: ask(question, context?) | history()
forge.log: record(experiment) | trend() | summary()
forge.session: checkpoint() | accept() | reject()`;

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

function buildPastSessionsSummary(state: ForgeState, currentSessionId: string): string {
  const past = state.sessions.filter((s) => s.id !== currentSessionId);
  if (past.length === 0) return "";

  const lines: string[] = ["## Past Research Sessions"];
  for (const s of past.slice(-10)) { // last 10 sessions
    const best = s.bestResult
      ? `best composite: ${s.bestResult.compositeScore.toFixed(4)}`
      : "no results";
    lines.push(
      `- **${s.name}** (${s.status}) — ${s.experiments.length} experiments, ${best}, focus: ${s.focus ?? "accuracy"}`
    );
  }
  lines.push(
    `\nUse \`forge.history.sessions()\` and \`forge.history.searchExperiments(query)\` for details.`
  );
  return lines.join("\n");
}

function buildRules(maxExperiments: number): string {
  return `## Rules

1. **Use \`playerData\`** — data is pre-loaded and split. Use \`playerData["username"].testGames\` for eval. Train/test separation is automatic.
2. **Check significance** before concluding an experiment worked. Use \`forge.eval.compare()\`.
3. **Max ${maxExperiments} experiments** per session. Start with quick evals (\`forge.eval.runQuick()\`) for triage, full eval for promising changes.
4. **Typecheck after code changes** with \`forge.code.typecheck()\` before running eval.
5. **Revert failed experiments** before trying the next one.
6. **Checkpoint regularly** with \`forge.session.checkpoint()\` (every 2-3 experiments).

### Mandatory: Notes After Every Experiment
After EACH experiment (success or failure), you MUST call:
\`\`\`
forge.knowledge.note("EXP <name>: <hypothesis>. Result: <metric delta>. Conclusion: <what was learned>", ["<focus>", "<technique>"])
\`\`\`
Also log with \`forge.log.record()\`. If you discover a novel insight, create a topic with \`forge.knowledge.create()\`. Compact topics with 10+ entries via \`forge.knowledge.compact(topicId)\`.

### Mandatory: Consult Oracle for Research Decisions
Use \`forge.oracle.ask(question, context)\` whenever you face ambiguity:
- **Before your first experiment**: ask the oracle what approach to try given the baseline metrics and player profile.
- **When an experiment fails unexpectedly**: ask why and what to try next.
- **When choosing between approaches**: ask the oracle to compare trade-offs.
- **Before making code changes**: ask about the expected effect on metrics.
The oracle cross-validates with multiple LLMs — use it to make better decisions. Aim for 3-5 oracle calls per session.

### Mandatory: Consult History Before New Approaches
Before trying something new, run:
\`forge.knowledge.search(topic)\`, \`forge.knowledge.notes({ tags: [topic] })\`, \`forge.history.searchExperiments(topic)\`
Don't repeat failed experiments.`;
}

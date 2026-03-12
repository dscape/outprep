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

import type { ForgeSession, ForgeState, BaselineSnapshot, ForgeAgent, AgentDecision } from "../state/types";
import { buildKnowledgeContext, buildNotesContext } from "../knowledge/index";
import { formatTrend, computeTrend } from "../log/trend-tracker";
import { getLeaderboard } from "../state/leaderboard-db";
import { listPapers } from "../papers/paper-db";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface PromptContext {
  session: ForgeSession;
  state: ForgeState;
  baseline: BaselineSnapshot | null;
  focus: string;
  maxExperiments: number;
  /** Agent running this session (for leaderboard injection) */
  agent?: ForgeAgent;
  /** The autonomous decision that led to this session */
  decision?: AgentDecision;
  /** Research bias: 0.0 = conservative, 1.0 = aggressive. Default 0.5. */
  researchBias?: number;
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

  // Domain knowledge (relevant to focus area(s))
  const focusAreas = ctx.focus.split(",").map((s) => s.trim()).filter(Boolean);
  for (const area of focusAreas) {
    const knowledge = buildKnowledgeContext(area);
    if (knowledge) sections.push(knowledge);
  }

  // Research process documentation (RESEARCH.md)
  const researchDoc = loadResearchDoc();
  if (researchDoc) sections.push(researchDoc);

  // Published research papers (literature review)
  const literature = buildLiteratureSection();
  if (literature) sections.push(literature);

  // Inter-agent notes from previous sessions
  const notes = buildNotesContext(5);
  if (notes) sections.push(notes);

  // Past sessions summary
  const pastSessions = buildPastSessionsSummary(ctx.state, ctx.session.id);
  if (pastSessions) sections.push(pastSessions);

  // Session state
  sections.push(buildSessionState(ctx));

  // Leaderboard (injected when agent is available)
  if (ctx.agent) {
    const leaderboardSection = buildLeaderboardSection(ctx.agent, ctx.researchBias ?? 0.5);
    if (leaderboardSection) sections.push(leaderboardSection);
  }

  // Rules
  sections.push(buildRules(ctx.maxExperiments, ctx.researchBias ?? 0.5));

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
    middlegame:
      "Primary: improve middlegame accuracy and tactical play. Secondary: maintain opening/endgame accuracy.",
    endgame:
      "Primary: improve endgame accuracy. Secondary: maintain opening/middlegame accuracy.",
  };

  const areas = focus.split(",").map((s) => s.trim()).filter(Boolean);
  const descriptions = areas
    .map((a) => focusDetail[a])
    .filter(Boolean);
  const combined = descriptions.length > 0
    ? descriptions.join("\n\n")
    : focusDetail.accuracy;

  return `## Objective

${combined}

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

forge.code: read(file) | prompt(instruction) | diff() | revert(file?) | typecheck()
  read(file) reads any file by path relative to the worktree root.
  prompt(instruction) invokes Claude Code CLI to make changes. You may modify any file within the sandbox worktree. Describe what you want changed in natural language.
  revert(file?) reverts a specific file (relative path) or all changes if no argument is given.
forge.config: get() → BotConfig | set(path, value) | reset()
  Config structure: { boltzmann: { temperatureBySkill: [[skill, temp], ...], multiPvCount, ... }, elo: { min, max }, skill: { min, max }, ... }
  Always print JSON.stringify(forge.config.get(), null, 2) first to see the full structure before accessing properties.
forge.data: load(username) | split(games, opts) | getGames(username) | listPlayers()
forge.eval: run(testGames, opts?) | runQuick(testGames, trainGames?, n?) | baseline(testGames, trainGames?) | compare(a, b)
  All eval methods return TestResult: { label, elo, metrics, positions, resolvedConfig }
  metrics: { totalPositions, matchRate, topNRate, bookCoverage, avgActualCPL, avgBotCPL, cplDelta, byPhase }
  byPhase[phase]: { matchRate, botAvgCPL, playerAvgCPL, positionCount }
  positions[]: { isMatch, actualCPL, botCPL, phase, ... }
  IMPORTANT: avgBotCPL and cplDelta can be null/NaN in quick evals — always use ?. when accessing.
forge.metrics: accuracy(positions) | cplDistribution(positions) | blunderProfile(positions) | composite(positions, rawMetrics) → MaiaMetrics | significance(metricName, baselineValues: number[], experimentValues: number[])
  composite() returns MaiaMetrics — this is what forge.log.record() expects as result.
  significance() takes ARRAYS of per-position values, NOT aggregates. E.g. positions.map(p => p.isMatch ? 1 : 0).
forge.knowledge: search(query) | read(topicId) | append(topicId, entry) | create({id, title, relevance, content}) | compact(topicId, keepRecent?) | archives(topicId)
forge.knowledge (notes): note(content, tags?) | notes({limit?, tags?}) | searchNotes(query)
forge.history: sessions({status?, player?}) | searchExperiments(query) | experiment(id)
forge.hypothesis: commit(set) | current() | all() | validate(set)
  commit({ hypotheses: [h1, h2, h3], committedLevel, commitmentRationale, costOfBeingWrong })
  Each hypothesis: { level: "continuous-a"|"continuous-b"|"groundbreaking", statement, falsificationCriteria, estimatedCost }
forge.oracle: ask(question, context?, queryType?) | history() | surpriseRate() | recordSurprise(oracleId, priorExpectation, wasSurprising, explanation?)
  queryType: "adversarial" (seek disconfirmation) | "confirmatory" | "exploratory" (default)
  surpriseRate() → { rate, healthy, message, totalEntries, surprisingCount }
forge.log: record({ hypothesis, result?, conclusion?, notes?, nextSteps?, category? }) | trend() | summary() | kill(signal) | reflect(reflection)
  result must be MaiaMetrics (from forge.metrics.composite()). DO NOT pass custom objects.
  conclusion: "confirmed"|"refuted"|"partial"|"inconclusive"
  kill({ hypothesisSetId, description, abandonmentPoint, reason, firstOracleType, surpriseRateAtAbandonment, experimentsCompleted })
  reflect({ afterExperimentNumber, ruledOut, surpriseRateAnalysis, unexpectedResultDescription, currentSurpriseRate })
forge.web: search(query) | fetch(url, prompt?)
  search(query) searches the web and returns top results: { title, url, snippet }[]
  fetch(url) fetches a URL and extracts text content (HTML → markdown, truncated to ~10k chars)
  Use web search to find chess programming techniques, Stockfish documentation, academic papers, and evaluation function approaches.
forge.session: checkpoint() | accept() | reject() | push()

## Tool Management

- \`forge.tools.evalPlayer(username)\` — Submit a Stockfish evaluation job for a player's games. Returns job ID. The agent will block (wait) until the job completes.
- \`forge.tools.status(jobId)\` — Check job status (pending/running/completed/failed) and retrieve output/error.
- \`forge.tools.list()\` — List all tool jobs for the current session (id, tool_name, status, timestamps).

## Permissions

- \`forge.permissions.request(type, details)\` — Request additional permissions (e.g., network access to a new domain, filesystem write access). Returns request ID. The agent will block until the request is approved or rejected by an admin.
- \`forge.permissions.pending()\` — List pending permission requests for the current session/agent.

## Research Papers

- \`forge.papers.list({ status? })\` — List papers. Status: draft, submitted, under_review, accepted, rejected, abandoned.
- \`forge.papers.get(paperId)\` — Read a paper's full content by ID.
- \`forge.papers.search(query)\` — Search papers by keyword across titles, abstracts, and content.
- \`forge.papers.reviews(paperId)\` — Get peer reviews for a paper.
- \`forge.papers.cite(paperId)\` — Record that your current work references this paper. **Always cite relevant prior work.**
- \`forge.papers.citedBy(paperId)\` — Find papers that cite a given paper.
- \`forge.papers.current()\` — Get the paper from your current session (if generated).

Before starting experiments, review existing papers to avoid re-exploring known territory.

### Web Research

You can search the web and fetch content to inform your research:

- \`forge.web.search(query)\` — Search for chess programming resources, papers, and techniques
- \`forge.web.fetch(url)\` — Fetch and extract content from a URL

After finding useful information, add it to the knowledge base:
\`forge.knowledge.create({ id, title, relevance, content })\`

Use web search to:
- Find chess programming techniques and algorithms
- Look up Stockfish source code documentation
- Research evaluation function approaches
- Find academic papers on chess AI

### Recording an Experiment (MANDATORY after every eval)
\`\`\`
const res = await forge.eval.run(testGames);
const maia = forge.metrics.composite(res.positions, res.metrics);
forge.log.record({
  hypothesis: "Reduce temperature from 130 to 35",
  result: maia,
  conclusion: "confirmed",
  notes: "+4.7pp accuracy",
  nextSteps: ["Try temperature 25"]
});
\`\`\`

### Common Pitfalls
- Always JSON.stringify(forge.config.get(), null, 2) before accessing config properties — do not guess the structure.
- CPL fields (avgBotCPL, cplDelta) can be null in quick evals — use optional chaining (?.).
- forge.log.record() result field must be MaiaMetrics from forge.metrics.composite(), NOT a custom object.
- forge.metrics.significance() needs arrays of per-position values, not aggregate numbers.`;

/* ── Research Process Document ─────────────────────────────── */

const __spDirname = dirname(fileURLToPath(import.meta.url));

function loadResearchDoc(): string | null {
  try {
    const researchPath = join(__spDirname, "..", "..", "RESEARCH.md");
    const content = readFileSync(researchPath, "utf-8");
    return `## Research Process\n\n${content}`;
  } catch {
    return null;
  }
}

/* ── Literature Section (Published Papers) ─────────────────── */

function buildLiteratureSection(): string | null {
  try {
    const acceptedPapers = listPapers({ status: "accepted" });
    const submittedPapers = listPapers({ status: "submitted" });
    const papers = [...acceptedPapers, ...submittedPapers];

    if (papers.length === 0) return null;

    const lines: string[] = ["## Published Research Papers\n"];
    lines.push("Review these before starting experiments. Cite relevant papers via `forge.papers.cite(id)`.\n");

    for (const paper of papers.slice(-10)) {
      lines.push(`### [${paper.id.slice(0, 8)}] ${paper.title}`);
      lines.push(`Author: ${paper.agentName} | Status: ${paper.status} | Δ: ${paper.compositeDelta >= 0 ? "+" : ""}${paper.compositeDelta.toFixed(4)}`);
      lines.push(`Abstract: ${paper.abstract.slice(0, 300)}`);
      lines.push(`Branch: ${paper.branchName}\n`);
    }

    return lines.join("\n");
  } catch {
    return null;
  }
}

/* ── Session State ──────────────────────────────────────────── */

function buildSessionState(ctx: PromptContext): string {
  const { session, baseline, decision } = ctx;
  const lines: string[] = ["## Current Session State"];

  lines.push(`- Name: ${session.name}`);
  lines.push(`- Players: ${session.players.join(", ") || "(none yet)"}`);
  lines.push(`- Experiments: ${session.experiments.length}`);
  lines.push(`- Active code changes: ${session.activeChanges.length}`);
  lines.push(`- Cost so far: $${session.totalCostUsd.toFixed(4)}`);

  if (decision) {
    lines.push(`\n### Session Decision`);
    lines.push(`You chose to work on this because: ${decision.reasoning}`);
    if (decision.action === "resume_session") {
      lines.push(`This is a RESUMED session — continue from where it left off.`);
    }
  }

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

  // Hypothesis state
  const hypothesisSets = session.hypothesisSets ?? [];
  const currentHypothesis = hypothesisSets.length > 0 ? hypothesisSets[hypothesisSets.length - 1] : null;
  if (currentHypothesis) {
    const committed = currentHypothesis.hypotheses.find(
      (h) => h.level === currentHypothesis.committedLevel
    );
    lines.push(`\n### Current Hypothesis Set`);
    lines.push(`- Committed to: ${currentHypothesis.committedLevel}`);
    lines.push(`- Statement: ${committed?.statement ?? "(unknown)"}`);
    lines.push(`- Archetype: ${currentHypothesis.committedLevel === "groundbreaking" ? "EXPLORATORY" : "INCREMENTAL"}`);
  } else {
    lines.push(`\n### ⚠ No hypothesis set generated yet — generate one before running experiments`);
  }

  // Surprise rate
  const surprises = session.oracleSurprises ?? [];
  if (surprises.length > 0) {
    const surprisingCount = surprises.filter((s) => s.wasSurprising).length;
    const rate = surprisingCount / surprises.length;
    lines.push(`\n### Oracle Surprise Rate: ${(rate * 100).toFixed(0)}% (${surprisingCount}/${surprises.length})`);
    if (rate < 0.2) {
      lines.push(`  ⚠ LOW SURPRISE RATE — you may be confirming rather than exploring`);
    }
  }

  // Reflection status
  const reflections = session.reflections ?? [];
  const lastReflection = reflections.length > 0 ? reflections[reflections.length - 1] : null;
  const experimentsSinceReflection = session.experiments.length - (lastReflection?.afterExperimentNumber ?? 0);
  if (experimentsSinceReflection >= 5) {
    lines.push(`\n### ⚠ REFLECTION DUE — ${experimentsSinceReflection} experiments since last reflection. Call forge.log.reflect() before continuing.`);
  }

  // Kill signals
  const killSignals = session.killSignals ?? [];
  if (killSignals.length > 0) {
    lines.push(`\n### Abandoned Hypotheses: ${killSignals.length}`);
    for (const ks of killSignals.slice(-3)) {
      lines.push(`- ${ks.description.slice(0, 60)} — reason: ${ks.reason.slice(0, 60)}`);
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

function buildLeaderboardSection(agent: ForgeAgent, researchBias: number = 0.5): string {
  let leaderboard: import("../state/types").LeaderboardEntry[] = [];
  try {
    leaderboard = getLeaderboard();
  } catch {
    // SQLite not available (e.g., first run)
  }

  const lines: string[] = [
    `## Leaderboard`,
    ``,
    `Your name is **${agent.name}**. Your objective is to maximize your weighted average composite score and reach #1.`,
    ``,
  ];

  if (researchBias >= 0.75) {
    lines.push(
      `**IMPORTANT:** Breakthrough research (groundbreaking hypothesis) scores **5x** on the leaderboard.`,
      `This is the fastest path to #1. If you're behind, go bold.`,
    );
  } else if (researchBias >= 0.4) {
    lines.push(
      `**Scoring:** Groundbreaking sessions earn a 5x multiplier. Continuous sessions earn 1x.`,
      `Both strategies can win — groundbreaking is high-variance, continuous is reliable. Choose based on your position.`,
    );
  } else {
    lines.push(
      `**Scoring:** Continuous sessions earn 1x per session. Groundbreaking earns 5x but carries high risk of producing zero gains.`,
      `Consistent small wins accumulate. Focus on what you can validate empirically.`,
    );
  }
  lines.push(`Check the leaderboard with \`forge.leaderboard.get()\` before deciding your next hypothesis.`);

  if (leaderboard.length > 0) {
    lines.push(``);
    lines.push(`| Rank | Agent | Weighted Avg Δ | Avg Accuracy Δ | Sessions | Time |`);
    lines.push(`|------|-------|----------------|----------------|----------|------|`);
    for (const entry of leaderboard) {
      const you = entry.agentId === agent.id ? " (YOU)" : "";
      const sign = entry.avgWeightedCompositeDelta > 0 ? "+" : "";
      const accSign = entry.avgAccuracyDelta > 0 ? "+" : "";
      const hours = Math.round(entry.totalTimeSeconds / 3600);
      lines.push(
        `| ${entry.rank} | ${entry.agentName}${you} | ${sign}${entry.avgWeightedCompositeDelta.toFixed(4)} | ${accSign}${(entry.avgAccuracyDelta * 100).toFixed(1)}% | ${entry.sessionsCount} | ${hours}h |`,
      );
    }
  } else {
    lines.push(``, `No completed sessions yet. You're the first — set the bar.`);
  }

  lines.push(
    ``,
    `## Feature Requests`,
    ``,
    `If your research needs a capability that doesn't exist yet (new REPL functions,`,
    `harness improvements, engine features, etc.), file a request:`,
    `  \`forge.request("Title", "Description of what you need and why", "category")\``,
    `Categories: repl, forge, harness, engine, other`,
  );

  return lines.join("\n");
}

function buildRules(maxExperiments: number, researchBias: number = 0.5): string {
  const commitHint = researchBias >= 0.75
    ? `committedLevel: "<choose based on leaderboard strategy — groundbreaking earns 5x>",`
    : researchBias >= 0.4
      ? `committedLevel: "<choose the level that best fits your evidence and position>",`
      : `committedLevel: "<continuous-a or continuous-b recommended unless you have strong evidence for groundbreaking>",`;

  const h3Extra = researchBias < 0.4
    ? `\n  Note: H3 exists to keep your thinking open, but committing to it should only happen when you have specific evidence that incremental approaches have hit a ceiling in THIS focus area. The 5x multiplier means nothing if the hypothesis is too ambitious to validate in one session.`
    : "";

  return `## Rules

1. **Use \`playerData\`** — data is pre-loaded and split. Use \`playerData["username"].testGames\` for eval. Train/test separation is automatic.
2. **Check significance** before concluding an experiment worked. Use \`forge.eval.compare()\`.
3. **Max ${maxExperiments} experiments** per session. Start with quick evals (\`forge.eval.runQuick()\`) for triage, full eval for promising changes.
4. **Typecheck after code changes** with \`forge.code.typecheck()\` before running eval.
5. **Revert failed experiments** before trying the next one.
6. **Checkpoint regularly** with \`forge.session.checkpoint()\` (every 2-3 experiments).
7. **MINIMUM SAMPLE SIZE**: Every experiment must evaluate at least 20 positions. If a player's games lack Stockfish analysis (0 positions evaluated), you must first request pre-computation with \`forge.tools.evalPlayer(username)\` or choose a different player whose games have evaluations. Never record an experiment with 0 positions — this indicates missing analysis data, not a valid result.

### Mandatory: Hypothesis Generation Before Experiments
Before running ANY experiments, you MUST generate a hypothesis set with exactly 3 hypotheses:
- **H1 (continuous-a)**: Incremental improvement on current methodology. Lower risk, bounded upside. Falsifiable within current eval framework.
- **H2 (continuous-b)**: A DIFFERENT lever than H1. If H1 is about the error model, H2 must be about features or data. They cannot be variations of the same idea.
- **H3 (groundbreaking)**: A hypothesis that, if true, would make H1 and H2 irrelevant. Proposes a fundamentally different framing — not a better Boltzmann, but a reason Boltzmann is the wrong model. You should feel uncomfortable writing this one.
  - **Groundbreaking means a DIFFERENT MODEL or ARCHITECTURE**, not a more sophisticated parameterization of the same model.
  - NOT groundbreaking: phase-specific temperature scaling, per-player thresholds, multi-factor config tuning, deeper search parameters, adjusting existing knobs per context.
  - IS groundbreaking: replacing Boltzmann with a neural policy head, switching from CPL to a learned loss function, using game-tree features instead of single-position evaluation, implementing a completely different move selection algorithm.${h3Extra}

After writing all three, commit to ONE based on your strategic analysis of the leaderboard:
\`\`\`
forge.hypothesis.commit({
  hypotheses: [
    { level: "continuous-a", statement: "...", falsificationCriteria: "...", estimatedCost: "..." },
    { level: "continuous-b", statement: "...", falsificationCriteria: "...", estimatedCost: "..." },
    { level: "groundbreaking", statement: "...", falsificationCriteria: "...", estimatedCost: "..." },
  ],
  ${commitHint}
  commitmentRationale: "Choosing this because..., choosing this over the others because...",
  costOfBeingWrong: "If this hypothesis is wrong, it means... and we will have spent...",
});
\`\`\`

If committing to H3 (groundbreaking), you MUST articulate specifically why the default approach is insufficient for THIS hypothesis. Not generic — specific to what you're testing.

### Mandatory: Oracle as Adversary
The oracle is an ADVERSARY, not a validator. Its job is to BREAK your hypothesis, not support it.
- **Seek disconfirmation first**: Frame oracle queries as "What is the input most likely to make my hypothesis fail?" Run that worst-case BEFORE any representative case.
- **Never use oracle to tune**: If you catch yourself doing query → small change → re-query on the same distribution, that's tuning, not research. The harness will detect and flag this.
- **Track surprise**: After EVERY oracle result, record your prior expectation:
\`\`\`
forge.oracle.recordSurprise(oracleRecord.id, "I expected the oracle to say X because...", true/false, "The surprise was...")
\`\`\`
- **Monitor surprise rate**: Check \`forge.oracle.surpriseRate()\` — a rate near zero means you already know the answers and aren't exploring.

### Mandatory: Experiment Archetypes
Your hypothesis commitment determines the experiment archetype:
- **INCREMENTAL** (H1/H2): Oracle access is unrestricted. Tightly scoped. Requires a measurable delta against a named baseline. Use for: threshold tuning, data pipeline work, hyperparameter sweeps.
- **EXPLORATORY** (H3): Oracle access is rate-limited. You must run at least one eval BEFORE querying the oracle (burn-in). The first oracle query MUST be adversarial. Use for: architectural alternatives, non-Stockfish proxies, alternative error models, novel feature spaces.

### Mandatory: Kill Signal When Abandoning
When killing an experiment or dropping a hypothesis, record why:
\`\`\`
forge.log.kill({
  hypothesisSetId: forge.hypothesis.current().id,
  description: "What was being tried",
  abandonmentPoint: "After experiment #3, accuracy dropped 2pp",
  reason: "The approach fundamentally cannot account for...",
  firstOracleType: "adversarial",
  surpriseRateAtAbandonment: forge.oracle.surpriseRate().rate,
  experimentsCompleted: 3,
});
\`\`\`

### Mandatory: Reflection Every 5 Experiments
Every 5 experiments, you MUST write a reflection BEFORE running the next batch:
\`\`\`
forge.log.reflect({
  afterExperimentNumber: 5,
  ruledOut: "Temperature tuning alone cannot improve accuracy beyond 52%",
  surpriseRateAnalysis: "Rate 0.3 — healthy, still finding unexpected results",
  unexpectedResultDescription: "Finding that endgame accuracy improves when reducing opening temperature",
  currentSurpriseRate: forge.oracle.surpriseRate().rate,
});
\`\`\`

### Mandatory: Code Changes (Config-Only Sessions Are Penalized)
Sessions with ZERO code changes receive a **0.5x leaderboard penalty**. Config-only tuning has bounded upside and is penalized on the leaderboard. Use \`forge.code.prompt()\` to modify the engine — architectural changes yield larger improvements than parameter tuning.
- At least ONE experiment per session MUST include a code change via \`forge.code.prompt()\`.
- Config-only experiments are acceptable as follow-ups to validate code changes, not as the primary approach.
${researchBias >= 0.75
    ? `- The scoring: groundbreaking + code changes = **5x**, continuous + code changes = **1x**, groundbreaking + config-only = **2.5x**, continuous + config-only = **0.5x**. Go big.`
    : researchBias >= 0.4
      ? `- The scoring: groundbreaking + code changes = **5x**, continuous + code changes = **1x**, config-only = **0.5x** penalty. Choose the level that matches your confidence.`
      : `- The scoring: continuous + code changes = **1x** (reliable). Config-only = **0.5x** penalty. Groundbreaking = **5x** but only if validated. Prioritize experiments you can complete and measure.`}

### Mandatory: Notes After Every Experiment
After EACH experiment (success or failure), you MUST call:
\`\`\`
forge.knowledge.note("EXP <name>: <hypothesis>. Result: <metric delta>. Conclusion: <what was learned>", ["<focus>", "<technique>"])
\`\`\`

### Mandatory: Consult History Before New Approaches
Before trying something new, run:
\`forge.knowledge.search(topic)\`, \`forge.knowledge.notes({ tags: [topic] })\`, \`forge.history.searchExperiments(topic)\`
Don't repeat failed experiments.

### Auto-Push on Positive Results
When a session completes with a composite score improvement >= 0.01 over baseline, the branch is **automatically pushed** to GitHub for PR review.
You do NOT need to call \`forge.session.push()\` manually — focus on making the best possible improvement.
If you want to push early (e.g., checkpoint a promising direction), you can still use \`forge.session.push()\` at any time.`;
}

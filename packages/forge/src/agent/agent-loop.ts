/**
 * Autonomous agent loop — the heart of forge.
 *
 * Drives the research session by calling the Anthropic API
 * with the system prompt and REPL tool. The agent writes
 * TypeScript code, we execute it, return results, and iterate.
 *
 * Follows the pattern: one tool (REPL), composable API,
 * persistent state, open-ended iteration until convergence.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { loadState, saveState, updateSession } from "../state/forge-state";
import { createSandbox, destroySandbox, commitSandbox } from "../repl/sandbox";
import type { SandboxInfo } from "../repl/sandbox";
import { createReplServer } from "../repl/repl-server";
import { createForgeApi, type ForgeApi } from "../repl/forge-api";
import { buildSystemPrompt, type PromptContext } from "./system-prompt";
import { writePid, removePid } from "../pid";
import { buildKnowledgeContext, buildNotesContext } from "../knowledge/index";
import { REPL_TOOL_DEFINITION, handleReplTool, formatToolOutput } from "./tool-handler";
import { CostTracker, CLAUDE_INPUT_COST_PER_1K, CLAUDE_OUTPUT_COST_PER_1K } from "./cost-tracker";
import { checkConvergence, DEFAULT_CONVERGENCE } from "./convergence";
import { createLogWriter, type LogWriter } from "./log-writer";
import type { ForgeSession, ForgeState, ConversationMessage } from "../state/types";

export interface ResearchOptions {
  name: string;
  players?: string[];
  focus: string;
  maxExperiments: number;
  seed: number;
  quick: boolean;
}

/**
 * Start a new autonomous research session.
 */
export async function runResearchSession(opts: ResearchOptions): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("  ✗ ANTHROPIC_API_KEY is required for autonomous mode");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const state = loadState();
  const costTracker = new CostTracker();
  const sessionId = randomUUID();
  const logWriter = createLogWriter(opts.name);
  const log = (msg: string, level: "info" | "warn" | "error" = "info") => {
    if (level === "error") console.error(msg);
    else if (level === "warn") console.warn(msg);
    else console.log(msg);
    logWriter.log(msg, level);
  };

  log(`\n  Forge Research Session: ${opts.name}`);
  log(`  Session ID: ${sessionId.slice(0, 8)}`);
  log(`  Focus: ${opts.focus}`);
  log(`  Max experiments: ${opts.maxExperiments}`);
  log(``);

  // Create sandbox (git worktree)
  log("  Creating sandbox...");
  const sandbox = createSandbox(sessionId);
  log(`  Sandbox: ${sandbox.worktreePath}`);

  // Create session record
  const session: ForgeSession = {
    id: sessionId,
    name: opts.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
    agentId: null,
    worktreeBranch: sandbox.branchName,
    focus: opts.focus,
    players: opts.players ?? [],
    baseline: null,
    experiments: [],
    bestResult: null,
    bestExperimentId: null,
    activeChanges: [],
    conversationHistory: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    oracleConsultations: [],
    interactions: [],
    hypothesisSets: [],
    oracleSurprises: [],
    killSignals: [],
    reflections: [],
  };

  state.sessions.push(session);
  state.activeSessionId = sessionId;
  saveState(state);
  writePid(sessionId);

  // Create REPL and inject forge API (playerData passed after construction below)
  const repl = createReplServer();

  // Pre-inject playerData so the agent has immediate access
  const { getGames, loadPlayer } = await import("../data/game-store");
  const { createSplit } = await import("../data/splits");

  const playerData: Record<string, {
    meta: ReturnType<typeof loadPlayer>;
    games: ReturnType<typeof getGames>;
    trainGames: ReturnType<typeof getGames>;
    testGames: ReturnType<typeof getGames>;
    split: ReturnType<typeof createSplit>["split"];
  }> = {};

  for (const username of opts.players ?? []) {
    const meta = loadPlayer(username);
    const games = getGames(username);
    if (meta && games.length > 0) {
      const result = createSplit(games, { seed: opts.seed, trainRatio: 0.8 });
      playerData[username] = {
        meta,
        games,
        trainGames: result.trainGames,
        testGames: result.testGames,
        split: result.split,
      };
    }
  }
  repl.inject("playerData", playerData);

  // Create forge API with playerData ref so eval auto-injects trainGames
  const forgeApi = createForgeApi(sandbox, session, state, playerData);
  repl.inject("forge", forgeApi);

  const promptCtx: PromptContext = {
    session,
    state,
    baseline: session.baseline,
    focus: opts.focus,
    maxExperiments: opts.maxExperiments,
  };

  // Initial user message
  const initialMessage = buildInitialMessage(opts, playerData);

  try {
    await runAgentLoop(client, repl, session, state, promptCtx, initialMessage, costTracker, opts, logWriter, forgeApi, sandbox);
  } catch (err) {
    log(`\n  ✗ Session error: ${err}`, "error");
    updateSession(state, sessionId, (s) => {
      s.status = "paused";
    });
  } finally {
    removePid(sessionId);
    repl.dispose();
    // Don't destroy sandbox on pause — it can be resumed
    if (session.status === "completed" || session.status === "abandoned") {
      // Safety: commit any remaining changes before destroying worktree
      try { commitSandbox(sandbox, `forge: safety commit before destroy for ${session.name}`); } catch { /* sandbox may already be clean */ }
      destroySandbox(sandbox);
    }
  }

  // Final summary
  const cost = costTracker.getSnapshot();
  log("\n  Session Complete");
  log("  ════════════════════════════════════════");
  log(`  Status: ${session.status}`);
  log(`  Experiments: ${session.experiments.length}`);
  log(`  Cost: ${costTracker.format()}`);

  if (session.bestResult) {
    log(
      `  Best accuracy: ${(session.bestResult.moveAccuracy * 100).toFixed(1)}%`
    );
    log(
      `  Best composite: ${session.bestResult.compositeScore.toFixed(4)}`
    );
  } else if (session.experiments.length === 0) {
    log(`  No experiments were recorded.`);
  }

  if (session.status === "paused") {
    log(`\n  Resume with: forge resume ${session.id.slice(0, 8)}`);
  }
  log(``);
  logWriter.close();
}

/**
 * Resume a paused research session.
 */
export async function resumeSession(
  state: ForgeState,
  session: ForgeSession
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("  ✗ ANTHROPIC_API_KEY is required");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const costTracker = new CostTracker();
  const logWriter = createLogWriter(session.name);
  const log = (msg: string, level: "info" | "warn" | "error" = "info") => {
    if (level === "error") console.error(msg);
    else if (level === "warn") console.warn(msg);
    else console.log(msg);
    logWriter.log(msg, level);
  };

  // Find the sandbox
  const { listSandboxes } = await import("../repl/sandbox");
  const sandboxes = listSandboxes();
  const sandbox = sandboxes.find((s) => s.sessionId === session.id);

  if (!sandbox) {
    log(`  ✗ Sandbox not found for session ${session.id.slice(0, 8)}`, "error");
    process.exit(1);
  }

  log(`\n  Resuming session: ${session.name}`);
  log(`  Experiments so far: ${session.experiments.length}`);

  // Recreate REPL, rebuild playerData, and inject forge API
  const repl = createReplServer();

  const { getGames, loadPlayer } = await import("../data/game-store");
  const { createSplit } = await import("../data/splits");

  const playerData: Record<string, any> = {};
  for (const username of session.players) {
    const meta = loadPlayer(username);
    const games = getGames(username);
    if (meta && games.length > 0) {
      const result = createSplit(games, { seed: 42, trainRatio: 0.8 });
      playerData[username] = { meta, games, ...result };
    }
  }
  repl.inject("playerData", playerData);

  const forgeApi = createForgeApi(sandbox, session, state, playerData);
  repl.inject("forge", forgeApi);

  const focus = session.focus ?? "accuracy";
  const promptCtx: PromptContext = {
    session,
    state,
    baseline: session.baseline,
    focus,
    maxExperiments: 20,
  };

  // Resume message
  const resumeMessage =
    `Resuming session "${session.name}". ` +
    `${session.experiments.length} experiments completed so far. ` +
    `${session.activeChanges.length} code changes currently applied. ` +
    `Continue the research from where you left off.`;

  updateSession(state, session.id, (s) => {
    s.status = "active";
  });
  writePid(session.id);

  try {
    await runAgentLoop(client, repl, session, state, promptCtx, resumeMessage, costTracker, {
      name: session.name,
      focus,
      maxExperiments: 20,
      seed: 42,
      quick: false,
    }, logWriter, forgeApi, sandbox);
  } catch (err) {
    log(`\n  ✗ Session error: ${err}`, "error");
    updateSession(state, session.id, (s) => {
      s.status = "paused";
    });
  } finally {
    removePid(session.id);
    repl.dispose();
    logWriter.close();
  }
}

/** Rough token estimate: ~4 chars per token for English/code */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Extract text content from a message for token estimation */
function messageText(msg: Anthropic.MessageParam): string {
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "tool_use") return JSON.stringify(b.input);
      if (b.type === "tool_result") return typeof b.content === "string" ? b.content : "";
      return "";
    })
    .join("\n");
}

/**
 * Prune conversation history to fit within a token budget.
 * Keeps first user message + last N turn pairs that fit.
 * Returns a pruned copy — does not mutate the original.
 *
 * IMPORTANT: tool_use (assistant) and tool_result (user) messages
 * are always kept/dropped as pairs to avoid Anthropic API errors.
 */
function pruneMessages(
  messages: Anthropic.MessageParam[],
  tokenBudget: number
): Anthropic.MessageParam[] {
  if (messages.length <= 3) return messages;

  // Always keep the first message (initial instructions)
  const first = messages[0];
  const firstTokens = estimateTokens(messageText(first));

  // Walk backwards in turn pairs (assistant + user) to keep tool_use/tool_result together
  const kept: Anthropic.MessageParam[] = [];
  let remaining = tokenBudget - firstTokens;

  let i = messages.length - 1;
  while (i >= 1) {
    const msg = messages[i];
    const msgTokens = estimateTokens(messageText(msg));

    // Check if this user message contains tool_result blocks (paired with previous assistant)
    const isToolResult =
      msg.role === "user" &&
      Array.isArray(msg.content) &&
      (msg.content as Anthropic.ToolResultBlockParam[]).some(
        (b) => b.type === "tool_result"
      );

    if (isToolResult && i > 1 && messages[i - 1].role === "assistant") {
      // Must keep/drop as a pair
      const prevTokens = estimateTokens(messageText(messages[i - 1]));
      const pairTokens = msgTokens + prevTokens;
      if (remaining - pairTokens < 0 && kept.length >= 4) break;
      remaining -= pairTokens;
      kept.unshift(messages[i - 1], msg);
      i -= 2;
    } else {
      if (remaining - msgTokens < 0 && kept.length >= 2) break;
      remaining -= msgTokens;
      kept.unshift(msg);
      i -= 1;
    }
  }

  return [first, ...kept];
}

/**
 * Main agent loop — iterates between Claude and the REPL.
 */
export async function runAgentLoop(
  client: Anthropic,
  repl: ReturnType<typeof createReplServer>,
  session: ForgeSession,
  state: ForgeState,
  promptCtx: PromptContext,
  initialMessage: string,
  costTracker: CostTracker,
  opts: ResearchOptions,
  logWriter?: LogWriter,
  forgeApi?: ForgeApi,
  sandbox?: SandboxInfo,
): Promise<void> {
  const log = (msg: string, level: "info" | "warn" | "error" = "info") => {
    if (level === "error") console.error(msg);
    else if (level === "warn") console.warn(msg);
    else console.log(msg);
    logWriter?.log(msg, level);
  };
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: initialMessage },
  ];

  const TOKEN_LIMIT = 9000; // stay under 10k with safety margin

  const convergenceConfig = {
    ...DEFAULT_CONVERGENCE,
    maxExperiments: opts.maxExperiments,
  };

  let turnCount = 0;
  const maxTurns = opts.maxExperiments * 10; // ~10 API calls per experiment
  let knowledgeSummarized = false;
  let convergenceFinalized = false;

  while (turnCount < maxTurns) {
    turnCount++;

    // Check convergence
    const convergence = checkConvergence(
      session.experiments,
      costTracker.getSnapshot(),
      convergenceConfig
    );

    if (convergence.shouldStop && !convergenceFinalized) {
      convergenceFinalized = true;
      log(`\n  ⏹ Convergence reached: ${convergence.reason}`);

      // Sync tracked changes immediately (don't wait for agent)
      if (forgeApi) {
        updateSession(state, session.id, (s) => {
          s.activeChanges = forgeApi.code.getTrackedChanges();
        });
      }

      // Give the agent one finalization turn
      messages.push({
        role: "user",
        content: [
          `Convergence reached: ${convergence.reason}. Session is ending. Before closing:`,
          "1. Leave a note with `forge.knowledge.note(summary, [tags])` summarizing your key findings and recommendations.",
          "2. Generate hypotheses for FUTURE sessions with `forge.hypothesis.commit()` — what should the next agent try?",
          "3. Compact any topics with large experiment histories using `forge.knowledge.compact(topicId)`.",
          "4. If you achieved a significant improvement, ensure the branch is pushed with `forge.session.push()`.",
          "5. Record a final reflection with `forge.log.reflect()` covering what was learned this session.",
          "",
          "After completing these steps, say 'Session complete' to end.",
        ].join("\n"),
      });
      continue; // give the agent one more turn
    }

    if (convergence.shouldStop && convergenceFinalized) {
      log(`\n  ⏹ Finalizing session: ${convergence.reason}`);

      // Ensure changes are committed and pushed before marking complete
      if (forgeApi) {
        try {
          const result = forgeApi.session.finalize();
          log(`  ${result}`);
        } catch (err) {
          log(`  Finalization warning: ${err}`, "warn");
        }
      }

      updateSession(state, session.id, (s) => {
        s.status = "completed";
      });
      break;
    }

    // Rebuild system prompt each turn (session state changes)
    promptCtx.baseline = session.baseline;
    const systemPrompt = buildSystemPrompt(promptCtx);

    // Compute token budgets
    const systemTokens = estimateTokens(systemPrompt) + estimateTokens(JSON.stringify(REPL_TOOL_DEFINITION));
    const messageBudget = TOKEN_LIMIT - systemTokens;
    const prunedMessages = pruneMessages(messages, messageBudget);

    log(`  Turn ${turnCount} [sys:${systemTokens} msg:${messages.length}→${prunedMessages.length}]`);

    if (systemTokens > 4000) {
      log(`  ⚠ System prompt ${systemTokens} tokens (budget: 4000)`, "warn");
    }

    // Call Claude
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: systemPrompt,
        tools: [REPL_TOOL_DEFINITION as Anthropic.Tool],
        messages: prunedMessages,
      });
    } catch (err) {
      log(`  ✗ API error: ${err}`, "error");
      // Wait and retry once
      await new Promise((r) => setTimeout(r, 5000));
      try {
        response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          system: systemPrompt,
          tools: [REPL_TOOL_DEFINITION as Anthropic.Tool],
          messages: prunedMessages,
        });
      } catch (retryErr) {
        throw new Error(`API failed after retry: ${retryErr}`);
      }
    }

    // Track cost
    const inTok = response.usage.input_tokens;
    const outTok = response.usage.output_tokens;
    costTracker.record(inTok, outTok);

    // Build interaction record
    const lastUserMsg = prunedMessages[prunedMessages.length - 1];
    const sentSummary = messageText(lastUserMsg).slice(0, 200);
    const receivedSummary = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n")
      .slice(0, 200);
    const interactionCost =
      (inTok / 1000) * CLAUDE_INPUT_COST_PER_1K +
      (outTok / 1000) * CLAUDE_OUTPUT_COST_PER_1K;

    updateSession(state, session.id, (s) => {
      const snap = costTracker.getSnapshot();
      s.totalInputTokens = snap.inputTokens;
      s.totalOutputTokens = snap.outputTokens;
      s.totalCostUsd = snap.estimatedCostUsd;
      if (!s.interactions) s.interactions = [];
      s.interactions.push({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        provider: "claude",
        model: "claude-sonnet-4-20250514",
        inputTokens: inTok,
        outputTokens: outTok,
        costUsd: interactionCost,
        purpose: "agent-turn",
        label: `Turn ${turnCount}`,
        sentSummary,
        receivedSummary,
      });
    });

    // Process response
    const assistantContent = response.content;

    // Log text blocks
    for (const block of assistantContent) {
      if (block.type === "text") {
        log(`  Agent: ${block.text.slice(0, 200)}${block.text.length > 200 ? "..." : ""}`);
      }
    }

    // Add assistant message to full conversation history
    messages.push({ role: "assistant", content: assistantContent });

    // Check if we need to handle tool calls
    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of assistantContent) {
        if (block.type === "tool_use" && block.name === "repl") {
          const input = block.input as { code: string };
          log(`  $:\n${input.code}\n  ────`);

          // Intercept process.stdout/stderr to capture progress writes
          const originalStdoutWrite = process.stdout.write.bind(process.stdout);
          const originalStderrWrite = process.stderr.write.bind(process.stderr);
          let pendingProgress = "";

          // Write directly to original stdout to avoid recursion:
          // log() -> console.log() -> process.stdout.write -> handleWrite -> log() ...
          const captureLog = (msg: string) => {
            originalStdoutWrite.call(process.stdout, `${msg}\n`);
            logWriter?.log(msg, "info");
          };

          const handleWrite = (chunk: string | Uint8Array) => {
            const str = typeof chunk === "string" ? chunk : chunk.toString();
            if (str.includes("\r") && !str.includes("\n")) {
              // \r-based progress — remember latest, don't log yet
              pendingProgress = str.replace(/\r/g, "").trim();
            } else {
              // Regular output — flush pending progress first, then log
              if (pendingProgress) {
                captureLog(`  ${pendingProgress}`);
                pendingProgress = "";
              }
              const trimmed = str.trim();
              if (trimmed) captureLog(`  ${trimmed}`);
            }
          };

          process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) => {
            handleWrite(args[0]);
            return originalStdoutWrite(...args);
          }) as typeof process.stdout.write;

          process.stderr.write = ((...args: Parameters<typeof process.stderr.write>) => {
            handleWrite(args[0]);
            return originalStderrWrite(...args);
          }) as typeof process.stderr.write;

          const toolOutput = await handleReplTool(repl, input);

          // Restore original writers + flush pending progress
          process.stdout.write = originalStdoutWrite;
          process.stderr.write = originalStderrWrite;
          if (pendingProgress) {
            log(`  ${pendingProgress}`);
            pendingProgress = "";
          }

          const formatted = formatToolOutput(toolOutput);

          if (toolOutput.error) {
            log(`  $:✗ ${toolOutput.error.slice(0, 200)}`, "error");
          } else {
            log(`  $:✓ (${toolOutput.durationMs}ms)`);
          }

          // Log REPL stdout (console.log output from executed code)
          if (toolOutput.output) {
            log(`  Output:\n${toolOutput.output}`);
          }

          // Log REPL return value
          if (toolOutput.result && toolOutput.result !== "(undefined)") {
            log(`  Result:\n${toolOutput.result}`);
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: formatted,
          });
        }
      }

      // Add tool results to conversation
      messages.push({ role: "user", content: toolResults });
    } else if (response.stop_reason === "end_turn") {
      // Agent chose to stop (no more tool calls)
      log("  Agent ended turn without tool call");

      // Save conversation history
      updateSession(state, session.id, (s) => {
        s.conversationHistory.push({
          role: "assistant",
          content: assistantContent
            .filter((b) => b.type === "text")
            .map((b) => (b as Anthropic.TextBlock).text)
            .join("\n"),
          timestamp: new Date().toISOString(),
        });
      });

      // If the agent says it's done, mark completed
      const lastText = assistantContent
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.TextBlock).text)
        .join("\n")
        .toLowerCase();

      const wantsDone =
        lastText.includes("session complete") ||
        lastText.includes("research complete") ||
        lastText.includes("stopping") ||
        lastText.includes("no further improvements");

      if (wantsDone && !knowledgeSummarized) {
        // Ask agent to summarize findings before closing
        knowledgeSummarized = true;

        // Sync tracked changes immediately
        if (forgeApi) {
          updateSession(state, session.id, (s) => {
            s.activeChanges = forgeApi.code.getTrackedChanges();
          });
        }

        messages.push({
          role: "user",
          content: [
            "Before closing, please:",
            "1. Leave a note with `forge.knowledge.note(summary, [tags])` summarizing your key findings and recommendations for future sessions.",
            "2. Generate hypotheses for FUTURE sessions with `forge.hypothesis.commit()` — what should the next agent try? Include at least one groundbreaking hypothesis.",
            "3. Compact any topics with large experiment histories using `forge.knowledge.compact(topicId)`.",
            "4. Create new topics with `forge.knowledge.create()` for any novel knowledge areas you discovered.",
            "5. If you achieved a significant improvement, push the branch with `forge.session.push()` so it can be reviewed as a PR.",
            "6. Record a final reflection with `forge.log.reflect()` covering what was learned this session.",
          ].join("\n"),
        });
        continue;
      }

      if (wantsDone) {
        // Finalize: sync changes, commit, push
        if (forgeApi) {
          try {
            const result = forgeApi.session.finalize();
            log(`  ${result}`);
          } catch (err) {
            log(`  Finalization warning: ${err}`, "warn");
          }
        }

        updateSession(state, session.id, (s) => {
          s.status = "completed";
        });
        break;
      }

      // Otherwise, prompt the agent to continue with refreshed knowledge context
      const focusAreas = opts.focus.split(",").map((s: string) => s.trim()).filter(Boolean);
      const freshKnowledge = focusAreas.map((a: string) => buildKnowledgeContext(a, 2)).filter(Boolean).join("\n\n");
      const freshNotes = buildNotesContext(3);
      const contextRefresh = [freshKnowledge, freshNotes].filter(Boolean).join("\n\n");

      // Compute reflection status
      const reflections = session.reflections ?? [];
      const lastRef = reflections.length > 0 ? reflections[reflections.length - 1] : null;
      const expsSinceReflection = session.experiments.length - (lastRef?.afterExperimentNumber ?? 0);
      const needsReflection = expsSinceReflection >= 5;

      const hasHypothesis = (session.hypothesisSets ?? []).length > 0;

      messages.push({
        role: "user",
        content: [
          "Continue with the next experiment. Remember:",
          !hasHypothesis
            ? "- ⚠ You have NOT generated a hypothesis set yet. Call forge.hypothesis.commit() BEFORE running experiments."
            : "",
          "- Frame oracle queries as adversarial: 'What would make my hypothesis fail?'",
          "- After each oracle result, record surprise: forge.oracle.recordSurprise(oracleId, expectation, wasSurprising)",
          "- After each experiment, record with forge.log.record() and leave a knowledge note.",
          needsReflection
            ? `- ⚠ REFLECTION DUE: ${expsSinceReflection} experiments since last reflection. Call forge.log.reflect() before continuing.`
            : "",
          "- Prefer code changes (forge.code.prompt()) over config-only experiments for larger improvements.",
          contextRefresh ? `\n## Updated Knowledge Context\n\n${contextRefresh}` : "",
        ].filter(Boolean).join("\n"),
      });
    }
  }

  if (turnCount >= maxTurns) {
    log(`\n  ⏹ Max turns reached (${maxTurns})`);
    updateSession(state, session.id, (s) => {
      s.status = "paused";
    });
  }
}

export function buildInitialMessage(opts: ResearchOptions, playerData: Record<string, any>): string {
  const parts: string[] = [];

  parts.push(`Start research session "${opts.name}" focused on ${opts.focus}.`);
  parts.push(`Seed: ${opts.seed}\n`);

  // Show available player data
  parts.push("## Available Players (pre-downloaded and split)\n");
  parts.push("Data is pre-loaded in `playerData`. Each entry has: `{ meta, games, trainGames, testGames, split }`\n");

  for (const username of opts.players ?? []) {
    const pd = playerData[username];
    if (pd) {
      const withEvals = pd.games.filter((g: any) => g.analysis?.length > 0).length;
      parts.push(
        `- **${username}**: ${pd.games.length} games (${pd.trainGames.length} train / ${pd.testGames.length} test), ` +
        `Elo ~${pd.meta?.estimatedElo ?? "?"}, ${withEvals} with evals`
      );
    }
  }

  // Give the agent a concrete first step
  const first = opts.players?.[0];
  parts.push(`\n## First step: compute baseline\n`);
  parts.push("```typescript");
  if (first) {
    parts.push(`const baseline = await forge.eval.baseline(playerData["${first}"].testGames);`);
    parts.push(`console.log("Baseline match rate:", baseline.metrics.matchRate);`);
  }
  parts.push("```");

  parts.push(`\n## After baseline, follow this workflow:\n`);
  parts.push(`**Step 1: Consult history** — check what previous sessions learned:`);
  parts.push("```typescript");
  parts.push(`await forge.knowledge.search("${opts.focus}")`);
  parts.push(`await forge.knowledge.notes({ limit: 5 })`);
  parts.push(`await forge.history.searchExperiments("${opts.focus}")`);
  parts.push("```");
  parts.push(`\n**Step 2: Generate hypotheses** — MANDATORY before any experiments:`);
  parts.push("```typescript");
  parts.push(`forge.hypothesis.commit({`);
  parts.push(`  hypotheses: [`);
  parts.push(`    { level: "continuous-a", statement: "...", falsificationCriteria: "...", estimatedCost: "..." },`);
  parts.push(`    { level: "continuous-b", statement: "...", falsificationCriteria: "...", estimatedCost: "..." },`);
  parts.push(`    { level: "groundbreaking", statement: "...", falsificationCriteria: "...", estimatedCost: "..." },`);
  parts.push(`  ],`);
  parts.push(`  committedLevel: "continuous-a",`);
  parts.push(`  commitmentRationale: "Choosing this because...",`);
  parts.push(`  costOfBeingWrong: "If wrong, it means...",`);
  parts.push(`});`);
  parts.push("```");
  parts.push(`\n**Step 3: Challenge your hypothesis** — first oracle query must seek disconfirmation:`);
  parts.push("```typescript");
  parts.push(`const oracleResult = await forge.oracle.ask("What inputs would most likely make this hypothesis fail?", JSON.stringify(baseline), "adversarial")`);
  parts.push(`forge.oracle.recordSurprise(oracleResult.id, "I expected...", true/false, "The surprise was...")`);
  parts.push("```");
  parts.push(`\n**Step 4: Run experiment, record, and leave a note:**`);
  parts.push("```typescript");
  parts.push(`forge.knowledge.note("EXP <name>: <hypothesis>. Result: <delta>. Conclusion: <learning>", ["${opts.focus}", "<technique>"])`);
  parts.push("```");
  parts.push(`\nRepeat steps 3-4. After every 5 experiments, call forge.log.reflect(). When abandoning a hypothesis, call forge.log.kill().`);

  if (opts.quick) {
    parts.push(`\nUse \`forge.eval.runQuick(testGames, trainGames)\` for faster triage iterations.`);
  }

  return parts.join("\n");
}

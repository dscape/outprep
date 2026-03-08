/**
 * Autonomous agent loop — the heart of forge.
 *
 * Drives the research session by calling the Anthropic API
 * with the system prompt and REPL tool. The agent writes
 * TypeScript code, we execute it, return results, and iterate.
 *
 * Follows the Witanlabs pattern: one tool (REPL), composable API,
 * persistent state, open-ended iteration until convergence.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { loadState, saveState, updateSession } from "../state/forge-state";
import { createSandbox, destroySandbox } from "../repl/sandbox";
import { createReplServer } from "../repl/repl-server";
import { createForgeApi } from "../repl/forge-api";
import { buildSystemPrompt } from "./system-prompt";
import { REPL_TOOL_DEFINITION, handleReplTool, formatToolOutput } from "./tool-handler";
import { CostTracker } from "./cost-tracker";
import { checkConvergence, DEFAULT_CONVERGENCE } from "./convergence";
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

  console.log(`\n  Forge Research Session: ${opts.name}`);
  console.log(`  Session ID: ${sessionId.slice(0, 8)}`);
  console.log(`  Focus: ${opts.focus}`);
  console.log(`  Max experiments: ${opts.maxExperiments}`);
  console.log();

  // Create sandbox (git worktree)
  console.log("  Creating sandbox...");
  const sandbox = createSandbox(sessionId);
  console.log(`  Sandbox: ${sandbox.worktreePath}`);

  // Create session record
  const session: ForgeSession = {
    id: sessionId,
    name: opts.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
    worktreeBranch: sandbox.branchName,
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
  };

  state.sessions.push(session);
  state.activeSessionId = sessionId;
  saveState(state);

  // Create REPL and inject forge API
  const repl = createReplServer();
  const forgeApi = createForgeApi(sandbox, session, state);
  repl.inject("forge", forgeApi);

  // Build system prompt
  const systemPrompt = buildSystemPrompt({
    session,
    baseline: session.baseline,
    focus: opts.focus,
    maxExperiments: opts.maxExperiments,
  });

  // Initial user message
  const initialMessage = buildInitialMessage(opts);

  try {
    await runAgentLoop(client, repl, session, state, systemPrompt, initialMessage, costTracker, opts);
  } catch (err) {
    console.error(`\n  ✗ Session error: ${err}`);
    updateSession(state, sessionId, (s) => {
      s.status = "paused";
    });
  } finally {
    repl.dispose();
    // Don't destroy sandbox on pause — it can be resumed
    if (session.status === "completed" || session.status === "abandoned") {
      destroySandbox(sandbox);
    }
  }

  // Final summary
  const cost = costTracker.getSnapshot();
  console.log("\n  Session Complete");
  console.log("  ════════════════════════════════════════");
  console.log(`  Status: ${session.status}`);
  console.log(`  Experiments: ${session.experiments.length}`);
  console.log(`  Cost: ${costTracker.format()}`);

  if (session.bestResult) {
    console.log(
      `  Best accuracy: ${(session.bestResult.moveAccuracy * 100).toFixed(1)}%`
    );
    console.log(
      `  Best composite: ${session.bestResult.compositeScore.toFixed(4)}`
    );
  }
  console.log();
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

  // Find the sandbox
  const { listSandboxes } = await import("../repl/sandbox");
  const sandboxes = listSandboxes();
  const sandbox = sandboxes.find((s) => s.sessionId === session.id);

  if (!sandbox) {
    console.error(`  ✗ Sandbox not found for session ${session.id.slice(0, 8)}`);
    process.exit(1);
  }

  console.log(`\n  Resuming session: ${session.name}`);
  console.log(`  Experiments so far: ${session.experiments.length}`);

  // Recreate REPL and forge API
  const repl = createReplServer();
  const forgeApi = createForgeApi(sandbox, session, state);
  repl.inject("forge", forgeApi);

  // Rebuild system prompt with current state
  const systemPrompt = buildSystemPrompt({
    session,
    baseline: session.baseline,
    focus: "accuracy", // TODO: persist focus in session
    maxExperiments: 20,
  });

  // Resume message
  const resumeMessage =
    `Resuming session "${session.name}". ` +
    `${session.experiments.length} experiments completed so far. ` +
    `${session.activeChanges.length} code changes currently applied. ` +
    `Continue the research from where you left off.`;

  updateSession(state, session.id, (s) => {
    s.status = "active";
  });

  try {
    await runAgentLoop(client, repl, session, state, systemPrompt, resumeMessage, costTracker, {
      name: session.name,
      focus: "accuracy",
      maxExperiments: 20,
      seed: 42,
      quick: false,
    });
  } catch (err) {
    console.error(`\n  ✗ Session error: ${err}`);
    updateSession(state, session.id, (s) => {
      s.status = "paused";
    });
  } finally {
    repl.dispose();
  }
}

/**
 * Main agent loop — iterates between Claude and the REPL.
 */
async function runAgentLoop(
  client: Anthropic,
  repl: ReturnType<typeof createReplServer>,
  session: ForgeSession,
  state: ForgeState,
  systemPrompt: string,
  initialMessage: string,
  costTracker: CostTracker,
  opts: ResearchOptions
): Promise<void> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: initialMessage },
  ];

  const convergenceConfig = {
    ...DEFAULT_CONVERGENCE,
    maxExperiments: opts.maxExperiments,
  };

  let turnCount = 0;
  const maxTurns = opts.maxExperiments * 10; // ~10 API calls per experiment

  while (turnCount < maxTurns) {
    turnCount++;

    // Check convergence
    const convergence = checkConvergence(
      session.experiments,
      costTracker.getSnapshot(),
      convergenceConfig
    );

    if (convergence.shouldStop) {
      console.log(`\n  ⏹ Stopping: ${convergence.reason}`);
      updateSession(state, session.id, (s) => {
        s.status = "completed";
      });
      break;
    }

    // Call Claude
    console.log(`  Turn ${turnCount}...`);

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: systemPrompt,
        tools: [REPL_TOOL_DEFINITION as Anthropic.Tool],
        messages,
      });
    } catch (err) {
      console.error(`  ✗ API error: ${err}`);
      // Wait and retry once
      await new Promise((r) => setTimeout(r, 5000));
      try {
        response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          system: systemPrompt,
          tools: [REPL_TOOL_DEFINITION as Anthropic.Tool],
          messages,
        });
      } catch (retryErr) {
        throw new Error(`API failed after retry: ${retryErr}`);
      }
    }

    // Track cost
    costTracker.record(
      response.usage.input_tokens,
      response.usage.output_tokens
    );
    updateSession(state, session.id, (s) => {
      const snap = costTracker.getSnapshot();
      s.totalInputTokens = snap.inputTokens;
      s.totalOutputTokens = snap.outputTokens;
      s.totalCostUsd = snap.estimatedCostUsd;
    });

    // Process response
    const assistantContent = response.content;

    // Log text blocks
    for (const block of assistantContent) {
      if (block.type === "text") {
        console.log(`  Agent: ${block.text.slice(0, 200)}${block.text.length > 200 ? "..." : ""}`);
      }
    }

    // Add assistant message to conversation
    messages.push({ role: "assistant", content: assistantContent });

    // Check if we need to handle tool calls
    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of assistantContent) {
        if (block.type === "tool_use" && block.name === "repl") {
          const input = block.input as { code: string };
          console.log(
            `  REPL: ${input.code.slice(0, 100)}${input.code.length > 100 ? "..." : ""}`
          );

          const toolOutput = await handleReplTool(repl, input);
          const formatted = formatToolOutput(toolOutput);

          if (toolOutput.error) {
            console.log(`  ✗ REPL error: ${toolOutput.error.slice(0, 200)}`);
          } else {
            console.log(
              `  ✓ REPL done (${toolOutput.durationMs}ms)`
            );
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
      console.log("  Agent ended turn without tool call");

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

      if (
        lastText.includes("session complete") ||
        lastText.includes("research complete") ||
        lastText.includes("stopping") ||
        lastText.includes("no further improvements")
      ) {
        updateSession(state, session.id, (s) => {
          s.status = "completed";
        });
        break;
      }

      // Otherwise, prompt the agent to continue
      messages.push({
        role: "user",
        content:
          "Continue with the next experiment. Use the REPL tool to make changes and evaluate.",
      });
    }
  }

  if (turnCount >= maxTurns) {
    console.log(`\n  ⏹ Max turns reached (${maxTurns})`);
    updateSession(state, session.id, (s) => {
      s.status = "paused";
    });
  }
}

function buildInitialMessage(opts: ResearchOptions): string {
  const parts: string[] = [];

  parts.push(
    `Start a new research session named "${opts.name}" focused on ${opts.focus}.`
  );

  if (opts.players && opts.players.length > 0) {
    parts.push(`Target players: ${opts.players.join(", ")}.`);
  } else {
    parts.push(
      `No specific players provided. Start by loading a player with forge.data.load().`
    );
  }

  parts.push(
    `\nSteps to begin:\n` +
      `1. Load player data and create a train/test split\n` +
      `2. Compute baseline metrics on the test set\n` +
      `3. Read the relevant knowledge topics for ideas\n` +
      `4. Formulate a hypothesis and make changes\n` +
      `5. Evaluate and compare against baseline\n` +
      `6. Log the experiment and iterate`
  );

  if (opts.quick) {
    parts.push(`\nUse quick evaluations (forge.eval.runQuick) for faster iteration.`);
  }

  return parts.join("\n");
}

/**
 * Oracle — Claude → ChatGPT → Claude cross-validation pipeline.
 *
 * The oracle provides a way for the autonomous agent to get a
 * "second opinion" on strategic decisions by routing through
 * two different LLMs and synthesizing their perspectives.
 *
 * Flow:
 *   1. Agent formulates a question about strategy
 *   2. Claude analyzes the question with domain context
 *   3. ChatGPT reviews Claude's analysis
 *   4. Claude synthesizes both perspectives into action items
 *   5. Agent receives actionable recommendations
 */

import { randomUUID } from "node:crypto";
import { askClaude, askChatGPT, getOracleAvailability } from "./clients";
import {
  CLAUDE_INPUT_COST_PER_1K,
  CLAUDE_OUTPUT_COST_PER_1K,
  CHATGPT_INPUT_COST_PER_1K,
  CHATGPT_OUTPUT_COST_PER_1K,
} from "../agent/cost-tracker";
import type { OracleRecord, InteractionRecord } from "../state/types";

export interface OracleQuery {
  question: string;
  domain: string;
  context: string;
}

const ORACLE_SYSTEM_PROMPT = `You are an expert in chess engine optimization, specifically in building bots that mimic human playing styles. You have deep knowledge of:

- Boltzmann move selection and temperature tuning
- Maia chess papers and their methodology for predicting human moves
- Error profiling (CPL distribution, blunder rates by game phase)
- Opening repertoire matching
- Stockfish MultiPV evaluation and depth tuning
- Statistical significance testing for chess engine evaluation

When analyzing a research question, be specific about:
1. What code/config changes to try
2. Expected effect size and direction
3. Potential pitfalls or interactions with other parameters
4. How to measure whether the change worked`;

const REVIEWER_SYSTEM_PROMPT = `You are a chess engine optimization expert reviewing a colleague's analysis of a human-style chess bot. Your role is to:

1. Identify gaps or errors in the analysis
2. Suggest alternative approaches the colleague may have missed
3. Flag any statistical or methodological concerns
4. Provide concrete, actionable improvements

Be direct and specific. Disagree where warranted.`;

const SYNTHESIZER_SYSTEM_PROMPT = `You are synthesizing two expert opinions on a chess engine optimization question. Your goal is to:

1. Identify points of agreement (these are likely correct)
2. Resolve disagreements by evaluating the reasoning
3. Extract 3-5 concrete action items the researcher should try
4. Assign a confidence level (high/medium/low) based on agreement level

Output format:
- Start with a brief synthesis paragraph
- Then list action items as numbered steps
- End with confidence assessment`;

/**
 * Consult the oracle with a research question.
 */
export interface OracleResult {
  record: OracleRecord;
  interactions: InteractionRecord[];
}

export async function consultOracle(
  query: OracleQuery
): Promise<OracleResult> {
  const availability = getOracleAvailability();
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  const contextBlock = query.context
    ? `\n\nCurrent context:\n${query.context}`
    : "";

  if (availability.mode === "none") {
    return {
      record: {
        id,
        timestamp,
        question: query.question,
        domain: query.domain,
        claudeInitial: "[No API keys configured]",
        chatgptResponse: "[No API keys configured]",
        claudeFinal: "[Oracle unavailable — set ANTHROPIC_API_KEY and OPENAI_API_KEY]",
        actionItems: [],
        confidence: "low",
      },
      interactions: [],
    };
  }

  // Step 1: Claude initial analysis
  console.log("  Oracle: Step 1/3 — Claude analyzing...");
  const claudeInitialResult = await askClaude({
    systemPrompt: ORACLE_SYSTEM_PROMPT,
    userMessage: `Domain: ${query.domain}${contextBlock}\n\nQuestion: ${query.question}`,
  });
  const claudeInitial = claudeInitialResult.text;

  // Step 2: ChatGPT peer review
  let chatgptResponse: string;
  let chatgptResult: { text: string; inputTokens: number; outputTokens: number } | null = null;
  if (availability.chatgpt) {
    console.log("  Oracle: Step 2/3 — ChatGPT reviewing...");
    chatgptResult = await askChatGPT({
      systemPrompt: REVIEWER_SYSTEM_PROMPT,
      userMessage:
        `A colleague analyzed this chess bot optimization question:\n\n` +
        `Question: ${query.question}\n\n` +
        `Their analysis:\n${claudeInitial}\n\n` +
        `Please review this analysis. What's right? What's wrong? What's missing?`,
    });
    chatgptResponse = chatgptResult.text;
  } else {
    chatgptResponse =
      "[ChatGPT unavailable — using Claude-only mode. Peer review skipped.]";
  }

  // Step 3: Claude synthesis
  console.log("  Oracle: Step 3/3 — Synthesizing...");
  const claudeFinalResult = await askClaude({
    systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
    userMessage:
      `Original question: ${query.question}\n\n` +
      `Analysis 1 (Claude):\n${claudeInitial}\n\n` +
      `Peer review (ChatGPT):\n${chatgptResponse}\n\n` +
      `Synthesize these perspectives into concrete action items.`,
  });
  const claudeFinal = claudeFinalResult.text;

  // Extract action items (lines starting with numbers)
  const actionItems = claudeFinal
    .split("\n")
    .filter((line) => /^\d+[\.\)]/.test(line.trim()))
    .map((line) => line.trim().replace(/^\d+[\.\)]\s*/, ""));

  // Assess confidence
  let confidence: OracleRecord["confidence"] = "medium";
  const finalLower = claudeFinal.toLowerCase();
  if (
    finalLower.includes("high confidence") ||
    finalLower.includes("strong agreement")
  ) {
    confidence = "high";
  } else if (
    finalLower.includes("low confidence") ||
    finalLower.includes("significant disagreement")
  ) {
    confidence = "low";
  }

  // Log response for human operator
  const preview = claudeFinal.slice(0, 200).replace(/\n/g, " ");
  console.log(`  Oracle: [${confidence}] ${preview}${claudeFinal.length > 200 ? "..." : ""}`);
  if (actionItems.length > 0) {
    console.log(`  Oracle: Action items:`);
    for (const item of actionItems) {
      console.log(`    - ${item}`);
    }
  }

  // Build interaction records for each API call
  const interactions: InteractionRecord[] = [];

  function claudeCost(inTok: number, outTok: number) {
    return (inTok / 1000) * CLAUDE_INPUT_COST_PER_1K + (outTok / 1000) * CLAUDE_OUTPUT_COST_PER_1K;
  }
  function chatgptCost(inTok: number, outTok: number) {
    return (inTok / 1000) * CHATGPT_INPUT_COST_PER_1K + (outTok / 1000) * CHATGPT_OUTPUT_COST_PER_1K;
  }

  interactions.push({
    id: randomUUID(),
    timestamp,
    provider: "claude",
    model: "claude-sonnet-4-20250514",
    inputTokens: claudeInitialResult.inputTokens,
    outputTokens: claudeInitialResult.outputTokens,
    costUsd: claudeCost(claudeInitialResult.inputTokens, claudeInitialResult.outputTokens),
    purpose: "oracle-initial",
    label: "Oracle: initial analysis",
    sentSummary: query.question.slice(0, 200),
    receivedSummary: claudeInitial.slice(0, 200),
  });

  if (availability.chatgpt && chatgptResult) {
    interactions.push({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      provider: "chatgpt",
      model: "gpt-4o",
      inputTokens: chatgptResult.inputTokens,
      outputTokens: chatgptResult.outputTokens,
      costUsd: chatgptCost(chatgptResult.inputTokens, chatgptResult.outputTokens),
      purpose: "oracle-review",
      label: "Oracle: ChatGPT review",
      sentSummary: claudeInitial.slice(0, 200),
      receivedSummary: chatgptResponse.slice(0, 200),
    });
  }

  interactions.push({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    provider: "claude",
    model: "claude-sonnet-4-20250514",
    inputTokens: claudeFinalResult.inputTokens,
    outputTokens: claudeFinalResult.outputTokens,
    costUsd: claudeCost(claudeFinalResult.inputTokens, claudeFinalResult.outputTokens),
    purpose: "oracle-synthesis",
    label: "Oracle: synthesis",
    sentSummary: query.question.slice(0, 200),
    receivedSummary: claudeFinal.slice(0, 200),
  });

  return {
    record: {
      id,
      timestamp,
      question: query.question,
      domain: query.domain,
      claudeInitial,
      chatgptResponse,
      claudeFinal,
      actionItems,
      confidence,
    },
    interactions,
  };
}

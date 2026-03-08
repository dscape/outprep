/**
 * API client wrappers for Claude and ChatGPT.
 *
 * Used by the oracle to cross-validate strategies through
 * a Claude → ChatGPT → Claude pipeline.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function getAnthropicClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

/**
 * Send a message to Claude and get a response.
 */
export async function askClaude(opts: {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const client = getAnthropicClient();
  if (!client) {
    return {
      text: "[Claude unavailable — ANTHROPIC_API_KEY not set]",
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.systemPrompt,
    messages: [{ role: "user", content: opts.userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/**
 * Send a message to ChatGPT and get a response.
 */
export async function askChatGPT(opts: {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const client = getOpenAIClient();
  if (!client) {
    return {
      text: "[ChatGPT unavailable — OPENAI_API_KEY not set]",
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userMessage },
    ],
  });

  return {
    text: response.choices[0]?.message?.content ?? "",
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
}

/**
 * Check which oracle models are available.
 */
export function getOracleAvailability(): {
  claude: boolean;
  chatgpt: boolean;
  mode: "full" | "claude-only" | "chatgpt-only" | "none";
} {
  const claude = !!process.env.ANTHROPIC_API_KEY;
  const chatgpt = !!process.env.OPENAI_API_KEY;

  let mode: "full" | "claude-only" | "chatgpt-only" | "none";
  if (claude && chatgpt) mode = "full";
  else if (claude) mode = "claude-only";
  else if (chatgpt) mode = "chatgpt-only";
  else mode = "none";

  return { claude, chatgpt, mode };
}

/**
 * Tool handler — executes TypeScript code from Claude in the forge REPL.
 *
 * This is the bridge between the Anthropic API tool call and the
 * persistent REPL environment. Claude sends TypeScript code as the
 * tool input, we execute it in the REPL, and return the output.
 */

import type { ReplServer } from "../repl/repl-server";

/** Tool definition for the Anthropic API */
export const REPL_TOOL_DEFINITION = {
  name: "repl",
  description: `Execute TypeScript code in the forge REPL. The \`forge\` object is available as a global with 30+ composable methods for reading/modifying engine code, running evaluations, analyzing metrics, consulting the knowledge base, and logging experiments. Variables persist across calls. Use \`await\` for async operations.`,
  input_schema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string" as const,
        description:
          "TypeScript code to execute. The `forge` object is available. Use `await` for async calls. The last expression's value is returned.",
      },
    },
    required: ["code"],
  },
};

export interface ToolInput {
  code: string;
}

export interface ToolOutput {
  output: string;
  result: string;
  error?: string;
  durationMs: number;
}

/**
 * Handle a REPL tool call from the agent.
 */
export async function handleReplTool(
  repl: ReplServer,
  input: ToolInput,
  timeoutMs = 300_000 // 5 minutes
): Promise<ToolOutput> {
  const result = await repl.execute(input.code, timeoutMs);

  // Format the result for the agent
  let resultStr: string;
  try {
    resultStr =
      result.result === undefined
        ? "(undefined)"
        : typeof result.result === "string"
          ? result.result
          : JSON.stringify(result.result, null, 2);
  } catch {
    resultStr = String(result.result);
  }

  // Truncate very long outputs to stay within context limits
  const maxOutputLen = 8000;
  const output =
    result.output.length > maxOutputLen
      ? result.output.slice(0, maxOutputLen) + "\n... (truncated)"
      : result.output;

  const resultTruncated =
    resultStr.length > maxOutputLen
      ? resultStr.slice(0, maxOutputLen) + "\n... (truncated)"
      : resultStr;

  return {
    output,
    result: resultTruncated,
    error: result.error,
    durationMs: result.durationMs,
  };
}

/**
 * Format tool output as a string for the Anthropic API response.
 */
export function formatToolOutput(toolOutput: ToolOutput): string {
  const parts: string[] = [];

  if (toolOutput.error) {
    parts.push(`ERROR: ${toolOutput.error}`);
  }

  if (toolOutput.output) {
    parts.push(`Output:\n${toolOutput.output}`);
  }

  if (toolOutput.result && toolOutput.result !== "(undefined)") {
    parts.push(`Result:\n${toolOutput.result}`);
  }

  parts.push(`(${toolOutput.durationMs}ms)`);

  return parts.join("\n\n");
}

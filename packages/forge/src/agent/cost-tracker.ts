/**
 * API cost tracking for forge sessions.
 *
 * Monitors Anthropic API spend per session to prevent runaway costs.
 * Uses approximate pricing based on Claude Sonnet 4 rates.
 */

export interface CostSnapshot {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  apiCalls: number;
}

// Approximate pricing (as of 2026)
export const CLAUDE_INPUT_COST_PER_1K = 0.003;
export const CLAUDE_OUTPUT_COST_PER_1K = 0.015;
export const CHATGPT_INPUT_COST_PER_1K = 0.0025;
export const CHATGPT_OUTPUT_COST_PER_1K = 0.01;

const INPUT_COST_PER_1K = CLAUDE_INPUT_COST_PER_1K;
const OUTPUT_COST_PER_1K = CLAUDE_OUTPUT_COST_PER_1K;

export class CostTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private apiCalls = 0;

  /**
   * Record token usage from an API call.
   */
  record(inputTokens: number, outputTokens: number): void {
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.apiCalls++;
  }

  /**
   * Get current cost snapshot.
   */
  getSnapshot(): CostSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCostUsd:
        (this.inputTokens / 1000) * INPUT_COST_PER_1K +
        (this.outputTokens / 1000) * OUTPUT_COST_PER_1K,
      apiCalls: this.apiCalls,
    };
  }

  /**
   * Check if cost exceeds a budget.
   */
  isOverBudget(maxCostUsd: number): boolean {
    return this.getSnapshot().estimatedCostUsd > maxCostUsd;
  }

  /**
   * Format cost for display.
   */
  format(): string {
    const snap = this.getSnapshot();
    return (
      `$${snap.estimatedCostUsd.toFixed(4)} ` +
      `(${snap.apiCalls} calls, ` +
      `${(snap.inputTokens / 1000).toFixed(1)}K in, ` +
      `${(snap.outputTokens / 1000).toFixed(1)}K out)`
    );
  }
}

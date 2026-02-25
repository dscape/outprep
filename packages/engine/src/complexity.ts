/**
 * Position complexity detection — adjusts search depth based on
 * how tactical or quiet a position is.
 *
 * Uses chess.js to count legal captures (fast — single move generation).
 * Tactical positions (many captures) get deeper search; quiet positions
 * (few captures) get shallower search for more natural, imperfect play.
 */

import { Chess } from "chess.js";
import type { BotConfig } from "./types";

/**
 * Return a depth adjustment based on position complexity.
 *
 * @returns positive for tactical positions, negative for quiet, 0 for normal.
 */
export function complexityDepthAdjust(
  fen: string,
  config: BotConfig["complexityDepth"]
): number {
  if (!config.enabled) return 0;

  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  const captures = moves.filter((m) => m.captured).length;

  if (captures >= config.captureThreshold) return config.tacticalBonus;
  if (captures <= config.quietThreshold) return -config.quietReduction;
  return 0;
}

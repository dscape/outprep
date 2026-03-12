/**
 * Oracle surprise rate tracking.
 *
 * Every oracle result should be logged with the agent's prior expectation.
 * The ratio of surprising results to confirmations is a health metric:
 *   - Near zero: agent already knew the answer — not researching, just documenting
 *   - > 0.2: healthy — genuine exploration is happening
 *   - > 0.5: high surprise — hypothesis space may be poorly understood
 */

import type { ForgeSession, OracleSurpriseEntry } from "../state/types";
import type { ForgeState } from "../state/types";
import { updateSession } from "../state/forge-state";

export interface SurpriseHealthAssessment {
  rate: number;
  totalEntries: number;
  surprisingCount: number;
  healthy: boolean;
  message: string;
}

export interface SurpriseTrackerOps {
  /** Record an oracle result with the agent's prior expectation */
  record(entry: Omit<OracleSurpriseEntry, "timestamp">): void;
  /** Get current surprise rate (ratio of surprising to total) */
  getRate(): number;
  /** Get all entries */
  getEntries(): OracleSurpriseEntry[];
  /** Get a health assessment */
  getHealthAssessment(): SurpriseHealthAssessment;
}

export function createSurpriseTracker(
  session: ForgeSession,
  state: ForgeState
): SurpriseTrackerOps {
  return {
    record(entry: Omit<OracleSurpriseEntry, "timestamp">) {
      const full: OracleSurpriseEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
      };
      updateSession(state, session.id, (s) => {
        if (!s.oracleSurprises) s.oracleSurprises = [];
        s.oracleSurprises.push(full);
      });
    },

    getRate(): number {
      const entries = session.oracleSurprises ?? [];
      if (entries.length === 0) return 0;
      const surprising = entries.filter((e) => e.wasSurprising).length;
      return surprising / entries.length;
    },

    getEntries(): OracleSurpriseEntry[] {
      return session.oracleSurprises ?? [];
    },

    getHealthAssessment(): SurpriseHealthAssessment {
      const entries = session.oracleSurprises ?? [];
      const totalEntries = entries.length;
      const surprisingCount = entries.filter((e) => e.wasSurprising).length;
      const rate = totalEntries > 0 ? surprisingCount / totalEntries : 0;

      let healthy: boolean;
      let message: string;

      if (totalEntries === 0) {
        healthy = true;
        message = "No oracle results tracked yet.";
      } else if (rate < 0.1) {
        healthy = false;
        message =
          `Surprise rate ${(rate * 100).toFixed(0)}% is very low — ` +
          `you may be confirming what you already know rather than exploring. ` +
          `Consider testing a more radical hypothesis.`;
      } else if (rate < 0.2) {
        healthy = false;
        message =
          `Surprise rate ${(rate * 100).toFixed(0)}% is below the 20% health threshold. ` +
          `Try framing oracle queries to challenge your assumptions.`;
      } else if (rate > 0.5) {
        healthy = true;
        message =
          `Surprise rate ${(rate * 100).toFixed(0)}% is high — ` +
          `the hypothesis space may be poorly understood. Consider narrowing scope.`;
      } else {
        healthy = true;
        message =
          `Surprise rate ${(rate * 100).toFixed(0)}% is healthy — ` +
          `genuine exploration is happening.`;
      }

      return { rate, totalEntries, surprisingCount, healthy, message };
    },
  };
}

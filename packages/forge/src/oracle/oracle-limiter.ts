/**
 * Oracle rate limiter for EXPLORATORY experiments.
 *
 * INCREMENTAL experiments get unrestricted oracle access.
 * EXPLORATORY experiments require:
 *   1. A burn-in period (at least 1 eval run) before the first oracle query
 *   2. The first oracle query must be adversarial
 */

import type { ExperimentArchetype } from "../state/types";

export interface OracleLimiterState {
  currentArchetype: ExperimentArchetype | null;
  /** Whether the burn-in eval has been completed */
  burnInComplete: boolean;
  /** Number of oracle queries in current experiment batch */
  queryCount: number;
  /** Whether the first oracle query was adversarial */
  firstQueryWasAdversarial: boolean | null;
}

export interface OracleLimiterOps {
  /** Called when an experiment batch starts */
  startExperiment(archetype: ExperimentArchetype): void;
  /** Check if an oracle query is allowed right now */
  canQuery(queryType?: "adversarial" | "confirmatory" | "exploratory"): {
    allowed: boolean;
    reason?: string;
  };
  /** Record that a query was made */
  recordQuery(queryType: "adversarial" | "confirmatory" | "exploratory"): void;
  /** Mark burn-in as complete (after first eval run) */
  completeBurnIn(): void;
  /** Get current state for inspection */
  getState(): OracleLimiterState;
}

export function createOracleLimiter(): OracleLimiterOps {
  const state: OracleLimiterState = {
    currentArchetype: null,
    burnInComplete: false,
    queryCount: 0,
    firstQueryWasAdversarial: null,
  };

  return {
    startExperiment(archetype: ExperimentArchetype) {
      state.currentArchetype = archetype;
      state.burnInComplete = false;
      state.queryCount = 0;
      state.firstQueryWasAdversarial = null;
    },

    canQuery(queryType?: "adversarial" | "confirmatory" | "exploratory") {
      // INCREMENTAL: unrestricted
      if (state.currentArchetype !== "exploratory") {
        return { allowed: true };
      }

      // EXPLORATORY: enforce burn-in
      if (!state.burnInComplete) {
        return {
          allowed: false,
          reason:
            "EXPLORATORY mode: must run at least one eval before querying the oracle. " +
            "Call forge.eval.run() or forge.eval.runQuick() first to complete burn-in.",
        };
      }

      // EXPLORATORY: first query must be adversarial
      if (state.queryCount === 0 && queryType !== "adversarial") {
        return {
          allowed: false,
          reason:
            'EXPLORATORY mode: first oracle query must be adversarial. ' +
            'Use queryType: "adversarial" to seek disconfirmation of your hypothesis.',
        };
      }

      return { allowed: true };
    },

    recordQuery(queryType: "adversarial" | "confirmatory" | "exploratory") {
      if (state.queryCount === 0) {
        state.firstQueryWasAdversarial = queryType === "adversarial";
      }
      state.queryCount++;
    },

    completeBurnIn() {
      state.burnInComplete = true;
    },

    getState() {
      return { ...state };
    },
  };
}

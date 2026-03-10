/**
 * Hypothesis manager — enforces structured hypothesis generation
 * before experiments can run.
 *
 * The agent must generate exactly 3 hypotheses:
 *   H1 (continuous-a): Incremental improvement, current methodology
 *   H2 (continuous-b): Different lever than H1
 *   H3 (groundbreaking): Fundamentally different framing
 *
 * Then commit to one, stating cost, risk of being wrong, and rationale.
 */

import { randomUUID } from "node:crypto";
import type {
  ForgeSession,
  ForgeState,
  HypothesisSet,
  HypothesisLevel,
  Hypothesis,
} from "../state/types";
import { updateSession } from "../state/forge-state";

export interface HypothesisOps {
  /** Record a set of 3 hypotheses with commitment */
  commit(
    set: Omit<HypothesisSet, "id" | "sessionId" | "timestamp">
  ): HypothesisSet;
  /** Get current active hypothesis set (most recent) */
  current(): HypothesisSet | null;
  /** Get all hypothesis sets for this session */
  all(): HypothesisSet[];
  /** Validate that a hypothesis set has proper structure */
  validate(
    set: Partial<HypothesisSet>
  ): { valid: boolean; errors: string[] };
}

export function createHypothesisOps(
  session: ForgeSession,
  state: ForgeState
): HypothesisOps {
  return {
    commit(
      input: Omit<HypothesisSet, "id" | "sessionId" | "timestamp">
    ): HypothesisSet {
      const validation = this.validate(input as Partial<HypothesisSet>);
      if (!validation.valid) {
        throw new Error(
          `Invalid hypothesis set:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`
        );
      }

      const set: HypothesisSet = {
        ...input,
        id: randomUUID(),
        sessionId: session.id,
        timestamp: new Date().toISOString(),
      };

      updateSession(state, session.id, (s) => {
        if (!s.hypothesisSets) s.hypothesisSets = [];
        s.hypothesisSets.push(set);
      });

      return set;
    },

    current(): HypothesisSet | null {
      const sets = session.hypothesisSets ?? [];
      return sets.length > 0 ? sets[sets.length - 1] : null;
    },

    all(): HypothesisSet[] {
      return session.hypothesisSets ?? [];
    },

    validate(
      set: Partial<HypothesisSet>
    ): { valid: boolean; errors: string[] } {
      const errors: string[] = [];

      // Check hypotheses array
      if (!set.hypotheses || !Array.isArray(set.hypotheses)) {
        errors.push("hypotheses must be an array");
      } else {
        if (set.hypotheses.length !== 3) {
          errors.push(`Exactly 3 hypotheses required, got ${set.hypotheses.length}`);
        }

        const levels = new Set<HypothesisLevel>();
        const requiredLevels: HypothesisLevel[] = [
          "continuous-a",
          "continuous-b",
          "groundbreaking",
        ];

        for (const h of set.hypotheses) {
          if (!h.level || !requiredLevels.includes(h.level)) {
            errors.push(
              `Invalid hypothesis level: "${h.level}". Must be one of: ${requiredLevels.join(", ")}`
            );
          } else {
            if (levels.has(h.level)) {
              errors.push(`Duplicate hypothesis level: "${h.level}"`);
            }
            levels.add(h.level);
          }
          validateHypothesis(h, errors);
        }

        // Ensure all 3 levels present
        for (const level of requiredLevels) {
          if (!levels.has(level)) {
            errors.push(`Missing hypothesis level: "${level}"`);
          }
        }
      }

      // Check committed level
      if (!set.committedLevel) {
        errors.push("committedLevel is required");
      } else {
        const validLevels: HypothesisLevel[] = [
          "continuous-a",
          "continuous-b",
          "groundbreaking",
        ];
        if (!validLevels.includes(set.committedLevel)) {
          errors.push(`Invalid committedLevel: "${set.committedLevel}"`);
        }
      }

      // Check commitment fields
      if (!set.commitmentRationale || set.commitmentRationale.trim().length < 20) {
        errors.push(
          "commitmentRationale must be at least 20 characters — explain why this hypothesis over the others"
        );
      }

      if (!set.costOfBeingWrong || set.costOfBeingWrong.trim().length < 10) {
        errors.push(
          "costOfBeingWrong must be at least 10 characters — what does it mean if this hypothesis is wrong?"
        );
      }

      // If committing to groundbreaking, rationale must address why default is insufficient
      if (set.committedLevel === "groundbreaking" && set.commitmentRationale) {
        if (set.commitmentRationale.length < 50) {
          errors.push(
            "When committing to a groundbreaking hypothesis, commitmentRationale must be at least 50 characters — " +
            "articulate specifically why the default approach is insufficient for this hypothesis"
          );
        }
      }

      return { valid: errors.length === 0, errors };
    },
  };
}

function validateHypothesis(h: Hypothesis, errors: string[]): void {
  if (!h.statement || h.statement.trim().length < 10) {
    errors.push(
      `Hypothesis "${h.level}": statement must be at least 10 characters`
    );
  }
  if (!h.falsificationCriteria || h.falsificationCriteria.trim().length < 10) {
    errors.push(
      `Hypothesis "${h.level}": falsificationCriteria must be at least 10 characters — what would prove this wrong?`
    );
  }
  if (!h.estimatedCost || h.estimatedCost.trim().length < 5) {
    errors.push(
      `Hypothesis "${h.level}": estimatedCost must be at least 5 characters`
    );
  }
}

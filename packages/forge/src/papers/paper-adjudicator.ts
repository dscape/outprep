/**
 * Paper adjudicator — determines the outcome after two peer reviews.
 *
 * Rules:
 * - Both accept  → accepted
 * - Any revise (no reject) → needs_revision
 * - One accept + one reject → needs_revision (benefit of doubt)
 * - Both reject → rejected
 */

import type { PaperReview, AdjudicationResult } from "./paper-types";

/**
 * Adjudicate two peer reviews and return the outcome.
 */
export function adjudicateReviews(reviews: PaperReview[]): AdjudicationResult {
  if (reviews.length < 2) {
    return {
      outcome: "needs_revision",
      reason: `Only ${reviews.length} review(s) received; need 2 for adjudication.`,
    };
  }

  const recommendations = reviews.map((r) => r.recommendation);
  const acceptCount = recommendations.filter((r) => r === "accept").length;
  const rejectCount = recommendations.filter((r) => r === "reject").length;
  const reviseCount = recommendations.filter((r) => r === "revise").length;

  // Both accept → accepted
  if (acceptCount === 2) {
    return {
      outcome: "accepted",
      reason: "Both reviewers recommend acceptance.",
    };
  }

  // Both reject → rejected
  if (rejectCount === 2) {
    return {
      outcome: "rejected",
      reason: "Both reviewers recommend rejection.",
    };
  }

  // Any revise (and no both-reject) → needs_revision
  if (reviseCount > 0) {
    return {
      outcome: "needs_revision",
      reason: `${reviseCount} reviewer(s) recommend revision. ${acceptCount > 0 ? "One accepts." : ""} ${rejectCount > 0 ? "One rejects." : ""}`.trim(),
    };
  }

  // One accept + one reject → needs_revision (benefit of doubt)
  if (acceptCount === 1 && rejectCount === 1) {
    return {
      outcome: "needs_revision",
      reason: "Split decision (one accept, one reject). Author gets a revision opportunity.",
    };
  }

  // Fallback (shouldn't happen with valid inputs)
  return {
    outcome: "needs_revision",
    reason: "Inconclusive review outcome. Author may revise and re-submit.",
  };
}

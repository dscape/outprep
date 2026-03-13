import { describe, it, expect } from "vitest";
import { adjudicateReviews } from "./paper-adjudicator";
import type { PaperReview } from "./paper-types";

function makeReview(recommendation: "accept" | "revise" | "reject"): PaperReview {
  return {
    id: `review-${Math.random().toString(36).slice(2)}`,
    paperId: "paper-1",
    reviewerAgentId: `agent-${Math.random().toString(36).slice(2)}`,
    reviewerAgentName: "TestReviewer",
    round: 1,
    summary: "Test review summary",
    strengths: ["Good methodology"],
    weaknesses: ["Limited scope"],
    questions: [],
    recommendation,
    detailedComments: "Detailed comments here",
    createdAt: new Date().toISOString(),
  };
}

describe("adjudicateReviews", () => {
  it("returns accepted when both reviewers accept", () => {
    const result = adjudicateReviews([makeReview("accept"), makeReview("accept")]);
    expect(result.outcome).toBe("accepted");
  });

  it("returns rejected when both reviewers reject", () => {
    const result = adjudicateReviews([makeReview("reject"), makeReview("reject")]);
    expect(result.outcome).toBe("rejected");
  });

  it("returns needs_revision when one accepts and one revises", () => {
    const result = adjudicateReviews([makeReview("accept"), makeReview("revise")]);
    expect(result.outcome).toBe("needs_revision");
  });

  it("returns needs_revision when both revise", () => {
    const result = adjudicateReviews([makeReview("revise"), makeReview("revise")]);
    expect(result.outcome).toBe("needs_revision");
  });

  it("returns needs_revision on split decision (accept + reject) — benefit of doubt", () => {
    const result = adjudicateReviews([makeReview("accept"), makeReview("reject")]);
    expect(result.outcome).toBe("needs_revision");
    expect(result.reason).toContain("Split decision");
  });

  it("returns needs_revision when one rejects and one revises", () => {
    const result = adjudicateReviews([makeReview("reject"), makeReview("revise")]);
    expect(result.outcome).toBe("needs_revision");
  });

  it("returns needs_revision with explanation when only 1 review", () => {
    const result = adjudicateReviews([makeReview("accept")]);
    expect(result.outcome).toBe("needs_revision");
    expect(result.reason).toContain("1 review");
  });

  it("returns needs_revision when no reviews provided", () => {
    const result = adjudicateReviews([]);
    expect(result.outcome).toBe("needs_revision");
    expect(result.reason).toContain("0 review");
  });
});

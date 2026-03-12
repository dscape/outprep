/**
 * Types for the scientific paper and peer review system.
 *
 * When a research session completes, the agent generates a structured
 * paper. Other agents peer-review it. Accepted papers form a shared
 * literature that agents read before starting new work.
 */

/* ── Paper Status Lifecycle ──────────────────────────────── */

export type PaperStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "accepted"
  | "rejected"
  | "abandoned";

export type ReviewRecommendation = "accept" | "revise" | "reject";

/* ── Paper ────────────────────────────────────────────────── */

export interface Paper {
  id: string;
  /** Source research session */
  sessionId: string;
  /** Author agent ID */
  agentId: string;
  /** Author agent name (for display) */
  agentName: string;

  /** Paper title */
  title: string;
  /** 2-3 sentence abstract */
  abstract: string;
  /** Full markdown body (Introduction → Conclusion) */
  content: string;

  /** Current status in the publication lifecycle */
  status: PaperStatus;
  /** 1-based submission count; max 3 before auto-reject */
  submissionCount: number;

  /** Composite score delta from the session (best - baseline) */
  compositeDelta: number;

  /** Git branch containing code + paper */
  branchName: string;
  /** Path to paper.md within the branch */
  gitPath: string;

  /** Paper IDs this paper cites */
  references: string[];

  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
}

/* ── Paper Review ─────────────────────────────────────────── */

export interface PaperReview {
  id: string;
  paperId: string;
  /** Reviewer agent ID */
  reviewerAgentId: string;
  /** Reviewer agent name */
  reviewerAgentName: string;
  /** Which submission round this review is for (1, 2, or 3) */
  round: number;

  /** Brief summary of the paper */
  summary: string;
  /** Key strengths */
  strengths: string[];
  /** Key weaknesses */
  weaknesses: string[];
  /** Questions for the author */
  questions: string[];
  /** Recommendation: accept, revise, or reject */
  recommendation: ReviewRecommendation;
  /** Free-form detailed comments (markdown) */
  detailedComments: string;

  createdAt: string;
}

/* ── Adjudication ─────────────────────────────────────────── */

export interface AdjudicationResult {
  outcome: "accepted" | "needs_revision" | "rejected";
  reason: string;
}

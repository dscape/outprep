/**
 * Papers module — scientific paper and peer review system.
 *
 * Re-exports all public APIs for the paper lifecycle:
 * generation, peer review, adjudication, and DB operations.
 */

export type {
  Paper,
  PaperStatus,
  PaperReview,
  ReviewRecommendation,
  AdjudicationResult,
} from "./paper-types";

export { generatePaper } from "./paper-generator";
export { generateReview } from "./paper-reviewer";
export { adjudicateReviews } from "./paper-adjudicator";

export {
  insertPaper,
  updatePaper,
  getPaper,
  getPaperBySession,
  listPapers,
  getPapersNeedingReview,
  getPapersNeedingRevision,
  searchPapers,
  insertReview,
  getReviewsForPaper,
  getReviewCountForPaper,
  insertReferences,
  getCitationsForPaper,
  getReferencesForPaper,
} from "./paper-db";

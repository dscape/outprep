/**
 * Papers operations — ForgeAPI namespace for scientific papers.
 *
 * Provides agents with read access to the paper catalog, search,
 * citation tracking, and review viewing.
 */

import type { ForgeSession } from "../state/types";
import type { Paper, PaperStatus, PaperReview } from "../papers/paper-types";
import {
  getPaper,
  getPaperBySession,
  listPapers,
  searchPapers,
  getReviewsForPaper,
  getCitationsForPaper,
  insertReferences,
} from "../papers/paper-db";

export interface PapersOps {
  /** List all papers, optionally filtered by status */
  list(opts?: { status?: PaperStatus }): Paper[];
  /** Get a specific paper by ID */
  get(paperId: string): Paper | null;
  /** Search papers by keyword across titles, abstracts, and content */
  search(query: string): Paper[];
  /** Get reviews for a paper */
  reviews(paperId: string): PaperReview[];
  /** Record that your current work cites this paper */
  cite(paperId: string): void;
  /** Get papers that cite a given paper */
  citedBy(paperId: string): Paper[];
  /** Get the paper from the current session (if any) */
  current(): Paper | null;
}

/**
 * Create papers operations bound to a session.
 */
export function createPapersOps(session: ForgeSession): PapersOps {
  // Track citations made during this session (will be persisted at paper generation time)
  const sessionCitations: string[] = [];

  return {
    list(opts) {
      return listPapers(opts);
    },

    get(paperId) {
      return getPaper(paperId);
    },

    search(query) {
      return searchPapers(query);
    },

    reviews(paperId) {
      return getReviewsForPaper(paperId);
    },

    cite(paperId) {
      const paper = getPaper(paperId);
      if (!paper) {
        throw new Error(`Paper ${paperId} not found.`);
      }
      if (!sessionCitations.includes(paperId)) {
        sessionCitations.push(paperId);
      }
      // If a paper already exists for this session, update its references immediately
      const currentPaper = getPaperBySession(session.id);
      if (currentPaper) {
        insertReferences(currentPaper.id, [paperId]);
      }
    },

    citedBy(paperId) {
      const citingIds = getCitationsForPaper(paperId);
      return citingIds
        .map((id) => getPaper(id))
        .filter((p): p is Paper => p !== null);
    },

    current() {
      return getPaperBySession(session.id);
    },
  };
}

/**
 * Paper database operations — CRUD for papers, reviews, and citations.
 *
 * Follows the same pattern as leaderboard-db.ts: uses the shared
 * forge SQLite database for all persistence.
 */

import { getForgeDb } from "../state/forge-db";
import type { Paper, PaperStatus, PaperReview, ReviewRecommendation } from "./paper-types";

/* ── Papers ───────────────────────────────────────────────── */

export function insertPaper(paper: Paper): void {
  const db = getForgeDb();
  db.prepare(`
    INSERT INTO papers
      (id, session_id, agent_id, agent_name, title, abstract, content,
       status, submission_count, composite_delta, branch_name, git_path,
       references_json, created_at, updated_at, submitted_at, accepted_at, rejected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    paper.id,
    paper.sessionId,
    paper.agentId,
    paper.agentName,
    paper.title,
    paper.abstract,
    paper.content,
    paper.status,
    paper.submissionCount,
    paper.compositeDelta,
    paper.branchName,
    paper.gitPath,
    JSON.stringify(paper.references),
    paper.createdAt,
    paper.updatedAt,
    paper.submittedAt,
    paper.acceptedAt,
    paper.rejectedAt,
  );
}

export function updatePaper(paperId: string, updates: Partial<Paper>): void {
  const db = getForgeDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push("status = ?"); values.push(updates.status); }
  if (updates.title !== undefined) { fields.push("title = ?"); values.push(updates.title); }
  if (updates.abstract !== undefined) { fields.push("abstract = ?"); values.push(updates.abstract); }
  if (updates.content !== undefined) { fields.push("content = ?"); values.push(updates.content); }
  if (updates.submissionCount !== undefined) { fields.push("submission_count = ?"); values.push(updates.submissionCount); }
  if (updates.submittedAt !== undefined) { fields.push("submitted_at = ?"); values.push(updates.submittedAt); }
  if (updates.acceptedAt !== undefined) { fields.push("accepted_at = ?"); values.push(updates.acceptedAt); }
  if (updates.rejectedAt !== undefined) { fields.push("rejected_at = ?"); values.push(updates.rejectedAt); }
  if (updates.references !== undefined) { fields.push("references_json = ?"); values.push(JSON.stringify(updates.references)); }

  if (fields.length === 0) return;

  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(paperId);

  db.prepare(`UPDATE papers SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function getPaper(paperId: string): Paper | null {
  const db = getForgeDb();
  const row = db.prepare("SELECT * FROM papers WHERE id = ?").get(paperId) as any;
  return row ? rowToPaper(row) : null;
}

export function getPaperBySession(sessionId: string): Paper | null {
  const db = getForgeDb();
  const row = db.prepare("SELECT * FROM papers WHERE session_id = ? ORDER BY created_at DESC LIMIT 1").get(sessionId) as any;
  return row ? rowToPaper(row) : null;
}

export function listPapers(opts?: { status?: PaperStatus; agentId?: string }): Paper[] {
  const db = getForgeDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.status) { conditions.push("status = ?"); params.push(opts.status); }
  if (opts?.agentId) { conditions.push("agent_id = ?"); params.push(opts.agentId); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM papers ${where} ORDER BY created_at DESC`).all(...params) as any[];
  return rows.map(rowToPaper);
}

/**
 * Get papers that need peer review (status "submitted" or "under_review"
 * with fewer than 2 reviews for the current round).
 * Excludes papers authored by the given agent.
 */
export function getPapersNeedingReview(excludeAgentId: string): Paper[] {
  const db = getForgeDb();
  const rows = db.prepare(`
    SELECT p.*, COUNT(pr.id) as review_count
    FROM papers p
    LEFT JOIN paper_reviews pr ON pr.paper_id = p.id AND pr.round = p.submission_count
    WHERE p.status IN ('submitted', 'under_review')
      AND p.agent_id != ?
    GROUP BY p.id
    HAVING review_count < 2
    ORDER BY p.created_at ASC
  `).all(excludeAgentId) as any[];
  return rows.map(rowToPaper);
}

/**
 * Get papers authored by the given agent that have reviewer feedback
 * requiring revision (status "under_review" with at least one "revise" recommendation).
 */
export function getPapersNeedingRevision(agentId: string): Array<Paper & { reviews: PaperReview[] }> {
  const papers = listPapers({ status: "under_review" as PaperStatus, agentId });
  const result: Array<Paper & { reviews: PaperReview[] }> = [];

  for (const paper of papers) {
    if (paper.submissionCount >= 3) continue; // Max submissions reached
    const reviews = getReviewsForPaper(paper.id, paper.submissionCount);
    // Check if any review says "revise"
    const hasReviseRecommendation = reviews.some((r) => r.recommendation === "revise");
    if (reviews.length >= 2 && hasReviseRecommendation) {
      result.push({ ...paper, reviews });
    }
  }

  return result;
}

export function searchPapers(query: string): Paper[] {
  const db = getForgeDb();
  const pattern = `%${query}%`;
  const rows = db.prepare(`
    SELECT * FROM papers
    WHERE title LIKE ? OR abstract LIKE ? OR content LIKE ?
    ORDER BY created_at DESC
  `).all(pattern, pattern, pattern) as any[];
  return rows.map(rowToPaper);
}

/* ── Reviews ──────────────────────────────────────────────── */

export function insertReview(review: PaperReview): void {
  const db = getForgeDb();
  db.prepare(`
    INSERT INTO paper_reviews
      (id, paper_id, reviewer_agent_id, reviewer_agent_name, round,
       summary, strengths, weaknesses, questions, recommendation,
       detailed_comments, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    review.id,
    review.paperId,
    review.reviewerAgentId,
    review.reviewerAgentName,
    review.round,
    review.summary,
    JSON.stringify(review.strengths),
    JSON.stringify(review.weaknesses),
    JSON.stringify(review.questions),
    review.recommendation,
    review.detailedComments,
    review.createdAt,
  );
}

export function getReviewsForPaper(paperId: string, round?: number): PaperReview[] {
  const db = getForgeDb();
  if (round !== undefined) {
    const rows = db.prepare(
      "SELECT * FROM paper_reviews WHERE paper_id = ? AND round = ? ORDER BY created_at ASC"
    ).all(paperId, round) as any[];
    return rows.map(rowToReview);
  }
  const rows = db.prepare(
    "SELECT * FROM paper_reviews WHERE paper_id = ? ORDER BY round ASC, created_at ASC"
  ).all(paperId) as any[];
  return rows.map(rowToReview);
}

export function getReviewCountForPaper(paperId: string, round: number): number {
  const db = getForgeDb();
  const result = db.prepare(
    "SELECT COUNT(*) as cnt FROM paper_reviews WHERE paper_id = ? AND round = ?"
  ).get(paperId, round) as any;
  return result?.cnt ?? 0;
}

/* ── Citations ────────────────────────────────────────────── */

export function insertReferences(citingPaperId: string, citedPaperIds: string[]): void {
  const db = getForgeDb();
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO paper_references (citing_paper_id, cited_paper_id) VALUES (?, ?)"
  );
  const insertAll = db.transaction(() => {
    for (const cited of citedPaperIds) {
      stmt.run(citingPaperId, cited);
    }
  });
  insertAll();
}

export function getCitationsForPaper(paperId: string): string[] {
  const db = getForgeDb();
  const rows = db.prepare(
    "SELECT citing_paper_id FROM paper_references WHERE cited_paper_id = ?"
  ).all(paperId) as any[];
  return rows.map((r) => r.citing_paper_id);
}

export function getReferencesForPaper(paperId: string): string[] {
  const db = getForgeDb();
  const rows = db.prepare(
    "SELECT cited_paper_id FROM paper_references WHERE citing_paper_id = ?"
  ).all(paperId) as any[];
  return rows.map((r) => r.cited_paper_id);
}

/* ── Row → Type Mappers ──────────────────────────────────── */

function rowToPaper(row: any): Paper {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    title: row.title,
    abstract: row.abstract,
    content: row.content,
    status: row.status as PaperStatus,
    submissionCount: row.submission_count,
    compositeDelta: row.composite_delta,
    branchName: row.branch_name,
    gitPath: row.git_path,
    references: safeParseJSON(row.references_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    acceptedAt: row.accepted_at,
    rejectedAt: row.rejected_at,
  };
}

function rowToReview(row: any): PaperReview {
  return {
    id: row.id,
    paperId: row.paper_id,
    reviewerAgentId: row.reviewer_agent_id,
    reviewerAgentName: row.reviewer_agent_name,
    round: row.round,
    summary: row.summary ?? "",
    strengths: safeParseJSON(row.strengths, []),
    weaknesses: safeParseJSON(row.weaknesses, []),
    questions: safeParseJSON(row.questions, []),
    recommendation: row.recommendation as ReviewRecommendation,
    detailedComments: row.detailed_comments ?? "",
    createdAt: row.created_at,
  };
}

function safeParseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

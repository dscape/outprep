import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Paper, PaperReview } from "./paper-types";

/* ── In-memory DB setup ──────────────────────────────────── */

let testDb: InstanceType<typeof Database>;

vi.mock("../state/forge-db", () => ({
  getForgeDb: () => testDb,
}));

// Import AFTER mock is set up (vitest hoists vi.mock automatically)
const {
  insertPaper,
  getPaper,
  listPapers,
  updatePaper,
  searchPapers,
  getPapersNeedingReview,
  insertReview,
  getReviewsForPaper,
  getReviewCountForPaper,
  insertReferences,
  getCitationsForPaper,
  getReferencesForPaper,
} = await import("./paper-db");

function createSchema(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      title TEXT NOT NULL,
      abstract TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      submission_count INTEGER DEFAULT 1,
      composite_delta REAL DEFAULT 0,
      branch_name TEXT,
      git_path TEXT,
      references_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      submitted_at TEXT,
      accepted_at TEXT,
      rejected_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_papers_session ON papers(session_id);
    CREATE INDEX IF NOT EXISTS idx_papers_agent ON papers(agent_id);
    CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);

    CREATE TABLE IF NOT EXISTS paper_reviews (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      reviewer_agent_id TEXT NOT NULL,
      reviewer_agent_name TEXT NOT NULL,
      round INTEGER NOT NULL DEFAULT 1,
      summary TEXT,
      strengths TEXT,
      weaknesses TEXT,
      questions TEXT,
      recommendation TEXT NOT NULL,
      detailed_comments TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_paper_reviews_paper ON paper_reviews(paper_id);
    CREATE INDEX IF NOT EXISTS idx_paper_reviews_reviewer ON paper_reviews(reviewer_agent_id);

    CREATE TABLE IF NOT EXISTS paper_references (
      citing_paper_id TEXT NOT NULL,
      cited_paper_id TEXT NOT NULL,
      PRIMARY KEY(citing_paper_id, cited_paper_id)
    );
    CREATE INDEX IF NOT EXISTS idx_paper_refs_cited ON paper_references(cited_paper_id);
  `);
}

/* ── Helpers ─────────────────────────────────────────────── */

function makePaper(overrides: Partial<Paper> = {}): Paper {
  const id = overrides.id ?? `paper-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    sessionId: "session-1",
    agentId: "agent-1",
    agentName: "TestAgent",
    title: "Test Paper Title",
    abstract: "This is a test abstract.",
    content: "# Introduction\n\nTest content.",
    status: "draft",
    submissionCount: 1,
    compositeDelta: 0.05,
    branchName: "forge/test-branch",
    gitPath: "paper.md",
    references: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    submittedAt: null,
    acceptedAt: null,
    rejectedAt: null,
    ...overrides,
  };
}

function makeReview(overrides: Partial<PaperReview> = {}): PaperReview {
  return {
    id: `review-${Math.random().toString(36).slice(2)}`,
    paperId: "paper-1",
    reviewerAgentId: "agent-2",
    reviewerAgentName: "ReviewerAgent",
    round: 1,
    summary: "Test review summary",
    strengths: ["Good methodology"],
    weaknesses: ["Limited scope"],
    questions: ["Why this approach?"],
    recommendation: "accept",
    detailedComments: "Detailed comments here",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/* ── Tests ───────────────────────────────────────────────── */

beforeEach(() => {
  testDb = new Database(":memory:");
  createSchema(testDb);
});

describe("Papers CRUD", () => {
  it("inserts and retrieves a paper", () => {
    const paper = makePaper({ id: "paper-1" });
    insertPaper(paper);
    const retrieved = getPaper("paper-1");

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("paper-1");
    expect(retrieved!.title).toBe("Test Paper Title");
    expect(retrieved!.agentId).toBe("agent-1");
    expect(retrieved!.status).toBe("draft");
    expect(retrieved!.compositeDelta).toBe(0.05);
  });

  it("returns null for non-existent paper", () => {
    expect(getPaper("nonexistent")).toBeNull();
  });

  it("updates paper fields", () => {
    const paper = makePaper({ id: "paper-2" });
    insertPaper(paper);
    updatePaper("paper-2", { status: "submitted", submittedAt: "2026-01-01T00:00:00Z" });

    const updated = getPaper("paper-2");
    expect(updated!.status).toBe("submitted");
    expect(updated!.submittedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("lists papers with status filter", () => {
    insertPaper(makePaper({ id: "p1", status: "submitted" }));
    insertPaper(makePaper({ id: "p2", status: "accepted" }));
    insertPaper(makePaper({ id: "p3", status: "submitted" }));

    const submitted = listPapers({ status: "submitted" });
    expect(submitted).toHaveLength(2);
    expect(submitted.every((p) => p.status === "submitted")).toBe(true);

    const accepted = listPapers({ status: "accepted" });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].id).toBe("p2");
  });

  it("lists papers with agentId filter", () => {
    insertPaper(makePaper({ id: "p1", agentId: "agent-A" }));
    insertPaper(makePaper({ id: "p2", agentId: "agent-B" }));
    insertPaper(makePaper({ id: "p3", agentId: "agent-A" }));

    const agentAPapers = listPapers({ agentId: "agent-A" });
    expect(agentAPapers).toHaveLength(2);
  });

  it("searches papers by title, abstract, and content", () => {
    insertPaper(makePaper({ id: "p1", title: "Boltzmann Temperature Analysis" }));
    insertPaper(makePaper({ id: "p2", title: "Opening Book Research", abstract: "Studies opening moves" }));
    insertPaper(makePaper({ id: "p3", title: "Endgame Tables", content: "Nothing about temperature" }));

    const results = searchPapers("Temperature");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // p1 matches by title, p3 matches by content
    const ids = results.map((p) => p.id);
    expect(ids).toContain("p1");
  });
});

describe("Papers needing review", () => {
  it("returns submitted papers excluding own papers", () => {
    insertPaper(makePaper({ id: "p1", agentId: "agent-1", status: "submitted" }));
    insertPaper(makePaper({ id: "p2", agentId: "agent-2", status: "submitted" }));
    insertPaper(makePaper({ id: "p3", agentId: "agent-3", status: "submitted" }));

    const needsReview = getPapersNeedingReview("agent-1");
    expect(needsReview).toHaveLength(2);
    expect(needsReview.every((p) => p.agentId !== "agent-1")).toBe(true);
  });

  it("excludes papers with 2 reviews already", () => {
    insertPaper(makePaper({ id: "p1", agentId: "agent-2", status: "submitted", submissionCount: 1 }));
    insertReview(makeReview({ id: "r1", paperId: "p1", reviewerAgentId: "agent-3", round: 1 }));
    insertReview(makeReview({ id: "r2", paperId: "p1", reviewerAgentId: "agent-4", round: 1 }));

    const needsReview = getPapersNeedingReview("agent-1");
    expect(needsReview).toHaveLength(0);
  });

  it("includes papers with < 2 reviews for current round", () => {
    insertPaper(makePaper({ id: "p1", agentId: "agent-2", status: "under_review", submissionCount: 1 }));
    insertReview(makeReview({ id: "r1", paperId: "p1", reviewerAgentId: "agent-3", round: 1 }));

    const needsReview = getPapersNeedingReview("agent-1");
    expect(needsReview).toHaveLength(1);
    expect(needsReview[0].id).toBe("p1");
  });
});

describe("Reviews CRUD", () => {
  it("inserts and retrieves reviews for a paper", () => {
    insertPaper(makePaper({ id: "paper-1" }));
    const review = makeReview({ id: "r1", paperId: "paper-1" });
    insertReview(review);

    const reviews = getReviewsForPaper("paper-1");
    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe("r1");
    expect(reviews[0].recommendation).toBe("accept");
    expect(reviews[0].strengths).toEqual(["Good methodology"]);
    expect(reviews[0].weaknesses).toEqual(["Limited scope"]);
  });

  it("filters reviews by round", () => {
    insertPaper(makePaper({ id: "paper-1" }));
    insertReview(makeReview({ id: "r1", paperId: "paper-1", round: 1 }));
    insertReview(makeReview({ id: "r2", paperId: "paper-1", round: 2 }));
    insertReview(makeReview({ id: "r3", paperId: "paper-1", round: 1 }));

    const round1 = getReviewsForPaper("paper-1", 1);
    expect(round1).toHaveLength(2);

    const round2 = getReviewsForPaper("paper-1", 2);
    expect(round2).toHaveLength(1);
  });

  it("counts reviews for a specific round", () => {
    insertPaper(makePaper({ id: "paper-1" }));
    insertReview(makeReview({ id: "r1", paperId: "paper-1", round: 1 }));
    insertReview(makeReview({ id: "r2", paperId: "paper-1", round: 1 }));
    insertReview(makeReview({ id: "r3", paperId: "paper-1", round: 2 }));

    expect(getReviewCountForPaper("paper-1", 1)).toBe(2);
    expect(getReviewCountForPaper("paper-1", 2)).toBe(1);
    expect(getReviewCountForPaper("paper-1", 3)).toBe(0);
  });
});

describe("Citations", () => {
  it("inserts and retrieves references", () => {
    insertPaper(makePaper({ id: "citing-paper" }));
    insertPaper(makePaper({ id: "cited-paper-1" }));
    insertPaper(makePaper({ id: "cited-paper-2" }));

    insertReferences("citing-paper", ["cited-paper-1", "cited-paper-2"]);

    const refs = getReferencesForPaper("citing-paper");
    expect(refs).toHaveLength(2);
    expect(refs).toContain("cited-paper-1");
    expect(refs).toContain("cited-paper-2");
  });

  it("retrieves citations (who cites a paper)", () => {
    insertPaper(makePaper({ id: "paper-A" }));
    insertPaper(makePaper({ id: "paper-B" }));
    insertPaper(makePaper({ id: "paper-C" }));

    insertReferences("paper-B", ["paper-A"]);
    insertReferences("paper-C", ["paper-A"]);

    const citations = getCitationsForPaper("paper-A");
    expect(citations).toHaveLength(2);
    expect(citations).toContain("paper-B");
    expect(citations).toContain("paper-C");
  });

  it("handles duplicate references gracefully (INSERT OR IGNORE)", () => {
    insertPaper(makePaper({ id: "p1" }));
    insertPaper(makePaper({ id: "p2" }));

    insertReferences("p1", ["p2"]);
    insertReferences("p1", ["p2"]); // duplicate

    const refs = getReferencesForPaper("p1");
    expect(refs).toHaveLength(1);
  });

  it("returns empty array when no citations exist", () => {
    insertPaper(makePaper({ id: "lonely-paper" }));
    expect(getCitationsForPaper("lonely-paper")).toEqual([]);
    expect(getReferencesForPaper("lonely-paper")).toEqual([]);
  });
});

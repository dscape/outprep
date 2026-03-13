import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") ?? "all";

  try {
    const Database = require("better-sqlite3");
    const path = require("path");
    const FORGE_ROOT =
      process.env.FORGE_DATA_DIR || path.join(process.cwd(), "packages", "forge");
    const DB_PATH = path.join(FORGE_ROOT, "forge.db");

    const db = new Database(DB_PATH, { readonly: true });

    // Build query
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status !== "all") {
      conditions.push("p.status = ?");
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get papers with review counts
    const papers = db.prepare(`
      SELECT
        p.*,
        COALESCE(rc.review_count, 0) as review_count
      FROM papers p
      LEFT JOIN (
        SELECT paper_id, COUNT(*) as review_count
        FROM paper_reviews
        GROUP BY paper_id
      ) rc ON rc.paper_id = p.id
      ${where}
      ORDER BY p.created_at DESC
    `).all(...params) as any[];

    // Map to PaperSummary
    const paperSummaries = papers.map((p: any) => ({
      id: p.id,
      sessionId: p.session_id,
      agentId: p.agent_id,
      agentName: p.agent_name,
      title: p.title,
      abstract: p.abstract,
      status: p.status,
      submissionCount: p.submission_count,
      compositeDelta: p.composite_delta,
      branchName: p.branch_name,
      reviewCount: p.review_count ?? 0,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));

    // Counts
    const countResults = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) as abandoned
      FROM papers
    `).get() as any;

    db.close();

    return NextResponse.json({
      papers: paperSummaries,
      counts: {
        total: countResults?.total ?? 0,
        submitted: countResults?.submitted ?? 0,
        accepted: countResults?.accepted ?? 0,
        rejected: countResults?.rejected ?? 0,
        abandoned: countResults?.abandoned ?? 0,
      },
    });
  } catch (error: any) {
    if (error.code === "SQLITE_CANTOPEN" || error.message?.includes("no such table")) {
      return NextResponse.json({
        papers: [],
        counts: { total: 0, submitted: 0, accepted: 0, rejected: 0, abandoned: 0 },
      });
    }
    console.error("Papers API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

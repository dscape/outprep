/**
 * Paper pipeline — generates research papers on session completion,
 * handles peer reviews, and performs adjudication.
 *
 * Extracted from agent-manager.ts to keep paper-related concerns isolated.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePaper } from "../papers/paper-generator";
import { generateReview } from "../papers/paper-reviewer";
import { adjudicateReviews } from "../papers/paper-adjudicator";
import {
  getPaper,
  updatePaper,
  insertReview,
  getReviewsForPaper,
  getReviewCountForPaper,
} from "../papers/paper-db";
import { commitSandbox, pushBranch } from "../repl/sandbox";
import type { ForgeSession } from "../state/types";

/**
 * Generate a research paper, write it to the sandbox, and push the branch.
 * Called after session completion (both new and resumed sessions).
 */
export async function generateAndPushPaper(
  session: ForgeSession,
  sandbox: { worktreePath: string; branchName: string },
  agentId: string,
  agentName: string,
): Promise<void> {
  try {
    console.log(`  📝 Generating research paper...`);
    const paper = await generatePaper(session, agentId, agentName, sandbox.branchName);

    // Write paper.md to the git worktree
    writeFileSync(join(sandbox.worktreePath, "paper.md"), paper.content, "utf-8");
    commitSandbox(sandbox as any, `forge: add research paper "${paper.title}"`);

    // Determine status based on improvement
    const baselineComposite = session.baseline?.aggregate?.compositeScore ?? 0;
    const bestComposite = session.bestResult?.compositeScore ?? 0;
    const delta = bestComposite - baselineComposite;

    if (delta > 0) {
      updatePaper(paper.id, { status: "submitted", submittedAt: new Date().toISOString() });
      console.log(`  📄 Paper "${paper.title}" submitted for review (Δ +${delta.toFixed(4)})`);
    } else {
      updatePaper(paper.id, { status: "abandoned" });
      console.log(`  📄 Paper "${paper.title}" auto-abandoned (no improvement)`);
    }

    // Always push — paper + code need to be on the remote
    try {
      pushBranch(sandbox.branchName);
      console.log(`  ✓ Pushed branch ${sandbox.branchName}`);
    } catch (pushErr) {
      console.log(`  ⚠ Push failed for ${sandbox.branchName}: ${pushErr}`);
    }
  } catch (paperErr) {
    console.warn(`  ⚠ Paper generation failed: ${paperErr}`);

    // Fallback: push positive results without paper
    if (session.status === "completed" && session.bestResult && session.baseline) {
      const baselineComposite = session.baseline.aggregate?.compositeScore ?? 0;
      const delta = session.bestResult.compositeScore - baselineComposite;
      if (delta >= 0.01) {
        try {
          pushBranch(sandbox.branchName);
          console.log(`  ✓ Auto-pushed branch ${sandbox.branchName} (composite Δ +${delta.toFixed(4)})`);
        } catch (err) {
          console.log(`  ⚠ Auto-push failed for ${sandbox.branchName}: ${err}`);
        }
      }
    }
  }
}

/**
 * Handle a "review_paper" decision. If the agent is NOT the author,
 * generate a peer review. If both reviews are in, adjudicate.
 * Returns true if a review was performed (no full session needed).
 */
export async function handlePaperReview(
  agentId: string,
  agentName: string,
  paperId: string,
): Promise<boolean> {
  const paper = getPaper(paperId);
  if (!paper) {
    console.log(`  ⚠ Paper ${paperId} not found.`);
    return false;
  }

  // ── Author's own paper needing revision → needs a full session
  if (paper.agentId === agentId) {
    console.log(`  📝 Paper "${paper.title}" is your own — starting revision session...`);
    return false; // Caller will handle as a full session
  }

  // ── Peer review by a different agent
  const existingReviews = getReviewCountForPaper(paper.id, paper.submissionCount);
  if (existingReviews >= 2) {
    console.log(`  ⚠ Paper "${paper.title}" already has 2 reviews for round ${paper.submissionCount}.`);
    return true;
  }

  console.log(`  🔍 Reviewing paper "${paper.title}" by ${paper.agentName}...`);

  // Update paper status
  if (paper.status === "submitted") {
    updatePaper(paper.id, { status: "under_review" });
  }

  let review;
  try {
    review = await generateReview(paper, agentId, agentName, paper.submissionCount);
    insertReview(review);
  } catch (err) {
    console.warn(`  ⚠ Review generation failed for paper ${paper.id}: ${err}`);
    return false; // Skip adjudication, agent can retry later
  }

  console.log(`  ✓ Review submitted: ${review.recommendation} (${review.strengths.length} strengths, ${review.weaknesses.length} weaknesses)`);

  // Check if we now have 2 reviews → adjudicate
  const allReviews = getReviewsForPaper(paper.id, paper.submissionCount);
  if (allReviews.length >= 2) {
    const result = adjudicateReviews(allReviews);
    console.log(`  📋 Adjudication: ${result.outcome} — ${result.reason}`);

    if (result.outcome === "accepted") {
      updatePaper(paper.id, { status: "accepted", acceptedAt: new Date().toISOString() });
    } else if (result.outcome === "rejected") {
      updatePaper(paper.id, { status: "rejected", rejectedAt: new Date().toISOString() });
    } else if (result.outcome === "needs_revision") {
      if (paper.submissionCount >= 3) {
        updatePaper(paper.id, { status: "rejected", rejectedAt: new Date().toISOString() });
        console.log(`  ⛔ Paper rejected after 3 submissions.`);
      }
      // Otherwise, paper stays "under_review" — author picks it up via decision step
    }
  }

  return true;
}

/**
 * Paper reviewer — generates a peer review for a research paper.
 *
 * Uses a single Claude API call to produce a structured review
 * following scientific publication standards.
 */

import { randomUUID } from "node:crypto";
import { askClaude } from "../oracle/clients";
import type { Paper, PaperReview } from "./paper-types";

const REVIEWER_SYSTEM_PROMPT = `You are a peer reviewer for chess engine research papers — specifically papers about building bots that mimic human playing styles (Maia-style research).

Your review must be rigorous, fair, and constructive. Evaluate:
- **Methodology**: Are hypotheses clear and falsifiable? Is the approach sound?
- **Results**: Are metrics statistically significant? Are there enough positions evaluated?
- **Reproducibility**: Can the experiment be reproduced from the branch and config?
- **Novelty**: Does this contribute new knowledge beyond existing papers?
- **Clarity**: Is the paper well-structured and easy to follow?

IMPORTANT: Respond with ONLY valid JSON in this exact format:
{
  "summary": "2-3 sentence summary of the paper's contribution",
  "strengths": ["strength 1", "strength 2", ...],
  "weaknesses": ["weakness 1", "weakness 2", ...],
  "questions": ["question for author 1", "question 2", ...],
  "recommendation": "accept" | "revise" | "reject",
  "detailedComments": "Detailed markdown comments with specific feedback..."
}

Guidelines for recommendations:
- **accept**: Solid methodology, significant results, reproducible, novel contribution.
- **revise**: Promising but has issues that can be addressed (unclear methodology, weak significance, missing per-phase analysis, etc.).
- **reject**: Fundamental flaws (no statistical significance, results contradict claims, methodology is unsound, no real contribution beyond config tweaks).`;

/**
 * Generate a peer review for a paper.
 */
export async function generateReview(
  paper: Paper,
  reviewerAgentId: string,
  reviewerAgentName: string,
  round: number,
): Promise<PaperReview> {
  const userMessage = buildReviewPrompt(paper);

  const response = await askClaude({
    systemPrompt: REVIEWER_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 3000,
  });

  const parsed = parseReviewResponse(response.text);

  const review: PaperReview = {
    id: randomUUID(),
    paperId: paper.id,
    reviewerAgentId,
    reviewerAgentName,
    round,
    summary: parsed.summary,
    strengths: parsed.strengths,
    weaknesses: parsed.weaknesses,
    questions: parsed.questions,
    recommendation: parsed.recommendation,
    detailedComments: parsed.detailedComments,
    createdAt: new Date().toISOString(),
  };

  return review;
}

/* ── Prompt Builder ───────────────────────────────────────── */

function buildReviewPrompt(paper: Paper): string {
  const sections: string[] = [];

  sections.push(`Please review the following research paper.\n`);
  sections.push(`## Paper Metadata`);
  sections.push(`- **Title**: ${paper.title}`);
  sections.push(`- **Author**: ${paper.agentName}`);
  sections.push(`- **Composite Delta**: ${paper.compositeDelta >= 0 ? "+" : ""}${paper.compositeDelta.toFixed(4)}`);
  sections.push(`- **Branch**: ${paper.branchName}`);
  sections.push(`- **Submission #${paper.submissionCount}**\n`);

  sections.push(`## Full Paper Content\n`);
  sections.push(paper.content);

  return sections.join("\n");
}

/* ── Response Parser ──────────────────────────────────────── */

function parseReviewResponse(raw: string): {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  questions: string[];
  recommendation: "accept" | "revise" | "reject";
  detailedComments: string;
} {
  // Try to extract JSON from the response
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      summary: "Failed to parse review response.",
      strengths: [],
      weaknesses: ["Review generation produced non-JSON output."],
      questions: [],
      recommendation: "revise",
      detailedComments: raw,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: parsed.summary ?? "",
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      recommendation: validateRecommendation(parsed.recommendation),
      detailedComments: parsed.detailedComments ?? "",
    };
  } catch {
    return {
      summary: "Failed to parse review JSON.",
      strengths: [],
      weaknesses: ["Review generation produced invalid JSON."],
      questions: [],
      recommendation: "revise",
      detailedComments: raw,
    };
  }
}

function validateRecommendation(rec: unknown): "accept" | "revise" | "reject" {
  if (rec === "accept" || rec === "revise" || rec === "reject") return rec;
  return "revise";
}

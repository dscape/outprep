/**
 * Paper generator — synthesizes a scientific paper from a completed session.
 *
 * Uses a single Claude API call to produce a structured paper with:
 * Title, Abstract, Introduction, Methodology, Results, Discussion,
 * Related Work, Conclusion, and References.
 */

import { randomUUID } from "node:crypto";
import { askClaude } from "../oracle/clients";
import type { ForgeSession, MaiaMetrics } from "../state/types";
import type { Paper } from "./paper-types";
import { listPapers, insertPaper, insertReferences } from "./paper-db";

const PAPER_SYSTEM_PROMPT = `You are a scientific writer specializing in chess engine research. You write concise, rigorous papers about experiments in chess bot development — specifically about building bots that mimic human playing styles (Maia-style research).

Your papers follow this structure:
1. **Title** — descriptive, under 100 characters
2. **Abstract** — 2-3 sentences summarizing the problem, approach, and key result
3. **Introduction** — what problem was addressed and why it matters (1-2 paragraphs)
4. **Methodology** — hypotheses tested, approach taken, tools and metrics used (2-3 paragraphs)
5. **Results** — quantitative outcomes with significance levels, per-phase breakdowns (1-2 paragraphs + data)
6. **Discussion** — what worked, what didn't, oracle insights, limitations (1-2 paragraphs)
7. **Related Work** — references to other papers by their IDs (if any are relevant)
8. **Conclusion** — key takeaway and suggested future directions (1 paragraph)
9. **References** — list of paper IDs cited

Be concise. Use data. Avoid hedging. If the session produced negative results, frame it as useful negative knowledge.

IMPORTANT: Output the paper as clean markdown. Start with "# [Title]" on the first line. Use "## Section" headers. For the References section, list each cited paper ID on its own line prefixed with "- ".`;

/**
 * Generate a scientific paper from a completed research session.
 */
export async function generatePaper(
  session: ForgeSession,
  agentId: string,
  agentName: string,
  branchName: string,
): Promise<Paper> {
  // Gather existing accepted papers for "Related Work" context
  const existingPapers = listPapers({ status: "accepted" });
  const submittedPapers = listPapers({ status: "submitted" });
  const allRelevantPapers = [...existingPapers, ...submittedPapers];

  // Build the session data prompt
  const userMessage = buildSessionDataPrompt(session, allRelevantPapers);

  // Generate paper via Claude
  const response = await askClaude({
    systemPrompt: PAPER_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 4096,
  });

  // Parse the generated paper
  const { title, abstract, references } = parsePaperContent(response.text, allRelevantPapers);

  // Compute composite delta
  const baselineComposite = session.baseline?.aggregate?.compositeScore ?? 0;
  const bestComposite = session.bestResult?.compositeScore ?? 0;
  const compositeDelta = bestComposite - baselineComposite;

  const now = new Date().toISOString();
  const paper: Paper = {
    id: randomUUID(),
    sessionId: session.id,
    agentId,
    agentName,
    title,
    abstract,
    content: response.text,
    status: "draft",
    submissionCount: 1,
    compositeDelta,
    branchName,
    gitPath: "paper.md",
    references,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    acceptedAt: null,
    rejectedAt: null,
  };

  // Persist
  insertPaper(paper);
  if (references.length > 0) {
    insertReferences(paper.id, references);
  }

  return paper;
}

/* ── Prompt Builder ───────────────────────────────────────── */

function buildSessionDataPrompt(
  session: ForgeSession,
  existingPapers: Paper[],
): string {
  const sections: string[] = [];

  sections.push(`Write a scientific paper about this research session.\n`);

  // Session overview
  sections.push(`## Session: ${session.name}`);
  sections.push(`Focus: ${session.focus}`);
  sections.push(`Players: ${session.players.join(", ")}`);
  sections.push(`Experiments: ${session.experiments.length}`);
  sections.push(`Status: ${session.status}\n`);

  // Baseline
  if (session.baseline?.aggregate) {
    sections.push(`## Baseline Metrics`);
    sections.push(formatMetrics(session.baseline.aggregate, "baseline"));
  }

  // Best result
  if (session.bestResult) {
    sections.push(`## Best Result`);
    sections.push(formatMetrics(session.bestResult, "best"));
    const delta = session.bestResult.compositeScore - (session.baseline?.aggregate?.compositeScore ?? 0);
    sections.push(`Composite delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}\n`);
  }

  // Hypotheses
  const hypothesisSets = session.hypothesisSets ?? [];
  if (hypothesisSets.length > 0) {
    sections.push(`## Hypotheses`);
    for (const hs of hypothesisSets) {
      sections.push(`Committed: ${hs.committedLevel}`);
      sections.push(`Rationale: ${hs.commitmentRationale}`);
      for (const h of hs.hypotheses) {
        sections.push(`- [${h.level}] ${h.statement} (falsification: ${h.falsificationCriteria})`);
      }
    }
    sections.push("");
  }

  // Experiments
  if (session.experiments.length > 0) {
    sections.push(`## Experiment Results`);
    for (const exp of session.experiments) {
      sections.push(`### Experiment ${exp.number}: ${exp.hypothesis}`);
      sections.push(`Category: ${exp.category} | Conclusion: ${exp.conclusion}`);
      sections.push(`Move accuracy: ${(exp.result.moveAccuracy * 100).toFixed(1)}% (delta: ${exp.delta.moveAccuracy >= 0 ? "+" : ""}${(exp.delta.moveAccuracy * 100).toFixed(2)}%)`);
      sections.push(`Composite: ${exp.result.compositeScore.toFixed(4)} (delta: ${exp.delta.compositeScore >= 0 ? "+" : ""}${exp.delta.compositeScore.toFixed(4)})`);

      if (exp.significance?.length > 0) {
        const sig = exp.significance.find((s) => s.metricName === "compositeScore" || s.metricName === "moveAccuracy");
        if (sig) {
          sections.push(`Significance: p=${sig.pValue.toFixed(4)}, d=${sig.effectSize.toFixed(3)}, ${sig.significant ? "SIGNIFICANT" : "not significant"}`);
        }
      }

      if (exp.notes) sections.push(`Notes: ${exp.notes}`);
      sections.push("");
    }
  }

  // Oracle consultations
  if (session.oracleConsultations.length > 0) {
    sections.push(`## Oracle Consultations`);
    for (const oc of session.oracleConsultations.slice(-3)) {
      sections.push(`Q: ${oc.question.slice(0, 200)}`);
      sections.push(`Type: ${oc.queryType ?? "general"} | Confidence: ${oc.confidence}`);
      if (oc.actionItems.length > 0) {
        sections.push(`Actions: ${oc.actionItems.join("; ")}`);
      }
    }
    sections.push("");
  }

  // Kill signals
  const kills = session.killSignals ?? [];
  if (kills.length > 0) {
    sections.push(`## Abandoned Approaches`);
    for (const k of kills) {
      sections.push(`- ${k.description}: ${k.reason}`);
    }
    sections.push("");
  }

  // Reflections
  const reflections = session.reflections ?? [];
  if (reflections.length > 0) {
    const lastReflection = reflections[reflections.length - 1];
    sections.push(`## Final Reflection`);
    sections.push(`Ruled out: ${lastReflection.ruledOut}`);
    sections.push(`Surprise rate: ${(lastReflection.currentSurpriseRate * 100).toFixed(0)}%\n`);
  }

  // Existing papers for "Related Work"
  if (existingPapers.length > 0) {
    sections.push(`## Existing Papers (cite relevant ones by ID)`);
    for (const p of existingPapers.slice(-15)) {
      sections.push(`- [${p.id}] "${p.title}" by ${p.agentName} (delta: ${p.compositeDelta >= 0 ? "+" : ""}${p.compositeDelta.toFixed(4)}, status: ${p.status})`);
    }
    sections.push("");
  }

  return sections.join("\n");
}

function formatMetrics(m: MaiaMetrics, label: string): string {
  const lines: string[] = [];
  lines.push(`${label} accuracy: ${(m.moveAccuracy * 100).toFixed(1)}% (opening: ${(m.moveAccuracyByPhase.opening * 100).toFixed(1)}%, mid: ${(m.moveAccuracyByPhase.middlegame * 100).toFixed(1)}%, end: ${(m.moveAccuracyByPhase.endgame * 100).toFixed(1)}%)`);
  lines.push(`${label} CPL KL: ${m.cplKLDivergence.toFixed(4)}`);
  lines.push(`${label} composite: ${m.compositeScore.toFixed(4)}`);
  lines.push(`Positions evaluated: ${m.positionsEvaluated}`);
  return lines.join("\n") + "\n";
}

/* ── Paper Parser ─────────────────────────────────────────── */

function parsePaperContent(
  raw: string,
  existingPapers: Paper[],
): { title: string; abstract: string; content: string; references: string[] } {
  // Extract title from first "# ..." line
  const titleMatch = raw.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? "Untitled Research Paper";

  // Extract abstract (text between ## Abstract and next ##)
  const abstractMatch = raw.match(/##\s*Abstract\s*\n([\s\S]*?)(?=\n##\s)/i);
  const abstract = abstractMatch?.[1]?.trim()?.slice(0, 500) ?? title;

  // Extract references (paper IDs mentioned in References section or inline)
  const existingIds = new Set(existingPapers.map((p) => p.id));
  const references: string[] = [];

  // Look for UUID-like references in the text
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const matches = raw.match(uuidPattern) ?? [];
  for (const match of matches) {
    if (existingIds.has(match) && !references.includes(match)) {
      references.push(match);
    }
  }

  return { title, abstract, content: raw, references };
}

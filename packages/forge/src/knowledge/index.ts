/**
 * Knowledge base — domain-specific expertise for the forge agent.
 *
 * Markdown files with YAML frontmatter organized by topic.
 * The agent consults these before formulating hypotheses.
 * Experiment results are appended as institutional memory.
 *
 * Also provides:
 * - Topic creation and compaction/archiving
 * - Inter-agent notes (shared scratchpad across sessions)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOPICS_DIR = join(__dirname, "topics");
const ARCHIVES_DIR = join(__dirname, "archives");
const NOTES_DIR = join(__dirname, "notes");

/* ── Types ────────────────────────────────────────────────── */

export interface Topic {
  id: string; // filename without extension
  title: string;
  relevance: string[];
  updated: string;
  content: string;
}

export interface TopicArchive {
  topicId: string;
  archivedAt: string;
  content: string;
}

export interface AgentNote {
  id: number;
  sessionId: string;
  sessionName: string;
  date: string;
  tags: string[];
  content: string;
}

/**
 * Load all knowledge topics.
 */
export function loadAllTopics(): Topic[] {
  if (!existsSync(TOPICS_DIR)) return [];

  const files = readdirSync(TOPICS_DIR).filter((f) => f.endsWith(".md"));
  return files.map((f) => loadTopic(f.replace(".md", ""))).filter(Boolean) as Topic[];
}

/**
 * Load a specific topic by ID.
 */
export function loadTopic(topicId: string): Topic | null {
  const filepath = join(TOPICS_DIR, `${topicId}.md`);
  if (!existsSync(filepath)) return null;

  const raw = readFileSync(filepath, "utf-8");
  const { data, content } = matter(raw);

  return {
    id: topicId,
    title: (data.topic as string) ?? topicId,
    relevance: (data.relevance as string[]) ?? [],
    updated: (data.updated as string) ?? "unknown",
    content: content.trim(),
  };
}

/**
 * Search topics by keyword relevance.
 * Returns topics sorted by match score (best first).
 */
export function searchTopics(query: string): Topic[] {
  const topics = loadAllTopics();
  const queryWords = query.toLowerCase().split(/\s+/);

  const scored = topics.map((topic) => {
    let score = 0;

    // Match against title
    for (const word of queryWords) {
      if (topic.title.toLowerCase().includes(word)) score += 3;
    }

    // Match against relevance tags
    for (const word of queryWords) {
      for (const tag of topic.relevance) {
        if (tag.toLowerCase().includes(word)) score += 2;
      }
    }

    // Match against content (lower weight)
    for (const word of queryWords) {
      const matches = (
        topic.content.toLowerCase().match(new RegExp(word, "g")) ?? []
      ).length;
      score += Math.min(matches, 3); // Cap at 3 to avoid long documents dominating
    }

    return { topic, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.topic);
}

/**
 * Append an experiment result to a topic's history section.
 */
export function appendToTopic(
  topicId: string,
  entry: { session: string; date: string; summary: string }
): void {
  const filepath = join(TOPICS_DIR, `${topicId}.md`);
  if (!existsSync(filepath)) return;

  const raw = readFileSync(filepath, "utf-8");
  const historyEntry = `\n- **${entry.session}** (${entry.date}): ${entry.summary}`;

  // Append to "Experiment History" section if it exists
  if (raw.includes("## Experiment History")) {
    const updated = raw.replace(
      /(## Experiment History\n(?:.*\n)*)/,
      `$1${historyEntry}\n`
    );
    writeFileSync(filepath, updated);
  } else {
    // Add the section at the end
    const updated = raw + `\n\n## Experiment History\n${historyEntry}\n`;
    writeFileSync(filepath, updated);
  }
}

/**
 * Build a context prompt from relevant topics for the agent.
 * Includes content from the top-N matching topics.
 */
export function buildKnowledgeContext(
  query: string,
  maxTopics = 1
): string {
  const topics = searchTopics(query).slice(0, maxTopics);

  if (topics.length === 0) {
    return "";
  }

  const sections = topics.map(
    (t) =>
      `### ${t.title}\n${t.content.slice(0, 800)}${t.content.length > 800 ? "\n..." : ""}`
  );

  return `## Domain Knowledge\n\n${sections.join("\n\n")}`;
}

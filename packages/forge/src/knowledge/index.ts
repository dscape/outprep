/**
 * Knowledge base — domain-specific expertise for the forge agent.
 *
 * Backed by SQLite tables: knowledge_topics and knowledge_notes.
 * The agent consults these before formulating hypotheses.
 * Experiment results are appended as institutional memory.
 *
 * Seed data lives in src/knowledge/topics/*.md. Notes are stored in SQLite.
 * On first access, if the DB tables are empty, topics are auto-populated
 * from the seed files so new developers get a working knowledge base.
 *
 * Also provides:
 * - Topic creation and compaction/archiving
 * - Inter-agent notes (shared scratchpad across sessions)
 */

import { getForgeDb } from "../state/forge-db";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_TOPICS_DIR = join(__dirname, "topics");

/* ── Types ────────────────────────────────────────────────── */

export interface Topic {
  id: string; // kebab-case identifier
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

/* ── Auto-seeding ─────────────────────────────────────────── */

let _seeded = false;

/**
 * Seed the DB from markdown files if the tables are empty.
 * Runs once per process. Idempotent.
 */
function ensureSeeded(): void {
  if (_seeded) return;
  _seeded = true;

  const db = getForgeDb();

  // Seed topics
  const topicCount = (db.prepare("SELECT COUNT(*) as cnt FROM knowledge_topics").get() as { cnt: number }).cnt;
  if (topicCount === 0 && existsSync(SEED_TOPICS_DIR)) {
    const files = readdirSync(SEED_TOPICS_DIR).filter(f => f.endsWith(".md"));
    const insert = db.prepare(
      "INSERT OR IGNORE INTO knowledge_topics (id, title, relevance, updated, content) VALUES (?, ?, ?, ?, ?)"
    );
    for (const f of files) {
      const raw = readFileSync(join(SEED_TOPICS_DIR, f), "utf-8");
      const { data, content } = matter(raw);
      const id = f.replace(/\.md$/, "");
      const relevance = Array.isArray(data.relevance) ? data.relevance : [];
      insert.run(id, String(data.topic ?? id), JSON.stringify(relevance), String(data.updated ?? ""), content.trim());
    }
  }

}

/**
 * Load all knowledge topics.
 */
export function loadAllTopics(): Topic[] {
  ensureSeeded();
  const db = getForgeDb();
  const rows = db.prepare("SELECT id, title, relevance, updated, content FROM knowledge_topics ORDER BY id").all() as {
    id: string; title: string; relevance: string; updated: string; content: string;
  }[];

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    relevance: safeParseArray(r.relevance),
    updated: r.updated,
    content: r.content,
  }));
}

/**
 * Load a specific topic by ID.
 */
export function loadTopic(topicId: string): Topic | null {
  const db = getForgeDb();
  const row = db.prepare("SELECT id, title, relevance, updated, content FROM knowledge_topics WHERE id = ?").get(topicId) as {
    id: string; title: string; relevance: string; updated: string; content: string;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    relevance: safeParseArray(row.relevance),
    updated: row.updated,
    content: row.content,
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
  const db = getForgeDb();
  const row = db.prepare("SELECT content FROM knowledge_topics WHERE id = ?").get(topicId) as { content: string } | undefined;
  if (!row) return;

  const historyEntry = `\n- **${entry.session}** (${entry.date}): ${entry.summary}`;

  let updated: string;
  if (row.content.includes("## Experiment History")) {
    updated = row.content.replace(
      /(## Experiment History\n(?:.*\n)*)/,
      `$1${historyEntry}\n`
    );
  } else {
    updated = row.content + `\n\n## Experiment History\n${historyEntry}\n`;
  }

  const date = new Date().toISOString().split("T")[0];
  db.prepare("UPDATE knowledge_topics SET content = ?, updated = ? WHERE id = ?").run(updated, date, topicId);
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

/* ── Topic Creation ───────────────────────────────────────── */

/**
 * Create a new knowledge topic.
 */
export function createTopic(opts: {
  id: string;
  title: string;
  relevance: string[];
  content: string;
}): Topic {
  // Validate kebab-case id
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(opts.id) && !/^[a-z0-9]$/.test(opts.id)) {
    throw new Error(`Topic id must be kebab-case (a-z, 0-9, hyphens): "${opts.id}"`);
  }

  const existing = loadTopic(opts.id);
  if (existing) {
    throw new Error(`Topic "${opts.id}" already exists`);
  }

  const date = new Date().toISOString().split("T")[0];
  const fullContent = `# ${opts.title}\n\n${opts.content}\n\n## Experiment History`;

  const db = getForgeDb();
  db.prepare(`
    INSERT INTO knowledge_topics (id, title, relevance, updated, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(opts.id, opts.title, JSON.stringify(opts.relevance), date, fullContent);

  return {
    id: opts.id,
    title: opts.title,
    relevance: opts.relevance,
    updated: date,
    content: fullContent,
  };
}

/* ── Topic Compaction / Archiving ─────────────────────────── */

/**
 * Archive old experiment history entries from a topic, keeping it lean.
 * Returns the archived content (stored in-memory only, not a separate file).
 */
export function compactTopic(
  topicId: string,
  opts?: { keepRecent?: number }
): TopicArchive | null {
  const keepRecent = opts?.keepRecent ?? 3;

  const topic = loadTopic(topicId);
  if (!topic) {
    throw new Error(`Topic "${topicId}" not found`);
  }

  // Find the Experiment History section
  const historyIdx = topic.content.indexOf("## Experiment History");
  if (historyIdx === -1) return null;

  const historySection = topic.content.slice(historyIdx);
  const lines = historySection.split("\n");

  // Parse entries (lines starting with "- **")
  const entries: string[] = [];
  for (const line of lines) {
    if (line.startsWith("- **")) {
      entries.push(line);
    }
  }

  // Nothing to archive if not enough entries
  if (entries.length <= keepRecent) return null;

  const toArchive = entries.slice(0, entries.length - keepRecent);
  const toKeep = entries.slice(entries.length - keepRecent);

  const date = new Date().toISOString().split("T")[0];

  // Rewrite the active topic with only recent entries
  const beforeHistory = topic.content.slice(0, historyIdx);
  const newHistory = ["## Experiment History", "", ...toKeep, ""].join("\n");
  const updatedContent = beforeHistory + newHistory;

  const db = getForgeDb();
  db.prepare("UPDATE knowledge_topics SET content = ?, updated = ? WHERE id = ?").run(updatedContent, date, topicId);

  return {
    topicId,
    archivedAt: date,
    content: toArchive.join("\n"),
  };
}

/**
 * Load archived experiment history for a topic.
 * (Archives are now part of the topic content history — this is a no-op for backward compat)
 */
export function loadArchives(_topicId: string): TopicArchive[] {
  return [];
}

/* ── Inter-Agent Notes ────────────────────────────────────── */

/**
 * Leave a note for future agent sessions.
 */
export function addNote(note: {
  sessionId: string;
  sessionName: string;
  tags: string[];
  content: string;
}): AgentNote {
  const date = new Date().toISOString().split("T")[0];
  const db = getForgeDb();

  const result = db.prepare(`
    INSERT INTO knowledge_notes (session_id, session_name, date, tags, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(note.sessionId, note.sessionName, date, JSON.stringify(note.tags), note.content);

  return {
    id: Number(result.lastInsertRowid),
    sessionId: note.sessionId,
    sessionName: note.sessionName,
    date,
    tags: note.tags,
    content: note.content,
  };
}

/**
 * Load recent agent notes, optionally filtered by tags.
 */
export function loadNotes(opts?: {
  limit?: number;
  tags?: string[];
}): AgentNote[] {
  const limit = opts?.limit ?? 10;
  const filterTags = opts?.tags?.map((t) => t.toLowerCase());

  const db = getForgeDb();
  const rows = db.prepare(
    "SELECT id, session_id, session_name, date, tags, content FROM knowledge_notes ORDER BY id DESC LIMIT ?"
  ).all(limit * 3) as { // Fetch extra to filter by tags
    id: number; session_id: string; session_name: string; date: string; tags: string; content: string;
  }[];

  const notes: AgentNote[] = [];
  for (const row of rows) {
    if (notes.length >= limit) break;

    const noteTags = safeParseArray(row.tags);

    // If tag filter is set, check for overlap
    if (filterTags && filterTags.length > 0) {
      const hasOverlap = noteTags.some((t) =>
        filterTags.some((ft) => t.toLowerCase().includes(ft))
      );
      if (!hasOverlap) continue;
    }

    notes.push({
      id: row.id,
      sessionId: row.session_id,
      sessionName: row.session_name,
      date: row.date,
      tags: noteTags,
      content: row.content,
    });
  }

  return notes;
}

/**
 * Search notes by keyword relevance.
 */
export function searchNotes(query: string): AgentNote[] {
  const allNotes = loadNotes({ limit: 100 });
  const queryWords = query.toLowerCase().split(/\s+/);

  const scored = allNotes.map((note) => {
    let score = 0;

    // Match against tags (high weight)
    for (const word of queryWords) {
      for (const tag of note.tags) {
        if (tag.toLowerCase().includes(word)) score += 3;
      }
    }

    // Match against content
    for (const word of queryWords) {
      const matches = (
        note.content.toLowerCase().match(new RegExp(word, "g")) ?? []
      ).length;
      score += Math.min(matches, 3);
    }

    return { note, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.note);
}

/**
 * Build a context section from recent agent notes for prompt injection.
 */
export function buildNotesContext(maxNotes = 5): string {
  const notes = loadNotes({ limit: maxNotes });
  if (notes.length === 0) return "";

  const MAX_TOTAL = 2000;
  let totalChars = 0;

  const entries: string[] = [];
  for (const note of notes) {
    const truncated =
      note.content.length > 200
        ? note.content.slice(0, 200) + "..."
        : note.content;

    const entry = `- **${note.sessionName}** (${note.date}) [${note.tags.join(", ")}]: ${truncated}`;

    if (totalChars + entry.length > MAX_TOTAL) break;
    totalChars += entry.length;
    entries.push(entry);
  }

  return `## Agent Notes (from previous sessions)\n\n${entries.join("\n")}`;
}

/* ── Helpers ──────────────────────────────────────────────── */

function safeParseArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

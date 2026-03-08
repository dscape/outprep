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

  const filepath = join(TOPICS_DIR, `${opts.id}.md`);
  if (existsSync(filepath)) {
    throw new Error(`Topic "${opts.id}" already exists`);
  }

  const date = new Date().toISOString().split("T")[0];
  const relevanceTags = opts.relevance.map((r) => r.trim()).join(", ");

  const fileContent = [
    "---",
    `topic: ${opts.title}`,
    `relevance: [${relevanceTags}]`,
    `updated: ${date}`,
    "---",
    "",
    `# ${opts.title}`,
    "",
    opts.content,
    "",
    "## Experiment History",
    "",
  ].join("\n");

  mkdirSync(TOPICS_DIR, { recursive: true });
  writeFileSync(filepath, fileContent);

  return {
    id: opts.id,
    title: opts.title,
    relevance: opts.relevance,
    updated: date,
    content: `# ${opts.title}\n\n${opts.content}\n\n## Experiment History`,
  };
}

/* ── Topic Compaction / Archiving ─────────────────────────── */

/**
 * Archive old experiment history entries from a topic, keeping it lean.
 * Archived content is saved to a separate file (human-readable, not injected into agent context).
 */
export function compactTopic(
  topicId: string,
  opts?: { keepRecent?: number }
): TopicArchive | null {
  const keepRecent = opts?.keepRecent ?? 3;
  const filepath = join(TOPICS_DIR, `${topicId}.md`);
  if (!existsSync(filepath)) {
    throw new Error(`Topic "${topicId}" not found`);
  }

  const raw = readFileSync(filepath, "utf-8");

  // Find the Experiment History section
  const historyIdx = raw.indexOf("## Experiment History");
  if (historyIdx === -1) return null;

  const historySection = raw.slice(historyIdx);
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

  // Write archive
  const date = new Date().toISOString().split("T")[0];
  const archiveDir = join(ARCHIVES_DIR, topicId);
  mkdirSync(archiveDir, { recursive: true });

  const archiveContent = [
    "---",
    `topic: ${topicId}`,
    `archivedAt: ${date}`,
    `entries: ${toArchive.length}`,
    "---",
    "",
    `## Experiment History (archived ${date})`,
    "",
    ...toArchive,
    "",
  ].join("\n");

  const archivePath = join(archiveDir, `${date}.md`);
  writeFileSync(archivePath, archiveContent);

  // Rewrite the active topic with only recent entries
  const beforeHistory = raw.slice(0, historyIdx);
  const newHistory = ["## Experiment History", "", ...toKeep, ""].join("\n");
  const { data } = matter(raw);
  const updatedRaw = beforeHistory + newHistory;

  // Update the frontmatter 'updated' field
  const updatedFile = updatedRaw.replace(
    /^(updated:\s*).+$/m,
    `$1${date}`
  );
  writeFileSync(filepath, updatedFile);

  return {
    topicId,
    archivedAt: date,
    content: toArchive.join("\n"),
  };
}

/**
 * Load archived experiment history for a topic.
 */
export function loadArchives(topicId: string): TopicArchive[] {
  const archiveDir = join(ARCHIVES_DIR, topicId);
  if (!existsSync(archiveDir)) return [];

  const files = readdirSync(archiveDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  return files.map((f) => {
    const raw = readFileSync(join(archiveDir, f), "utf-8");
    const { data, content } = matter(raw);
    return {
      topicId,
      archivedAt: (data.archivedAt as string) ?? f.replace(".md", ""),
      content: content.trim(),
    };
  });
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
  mkdirSync(NOTES_DIR, { recursive: true });

  // Determine next sequential number
  const existing = existsSync(NOTES_DIR)
    ? readdirSync(NOTES_DIR).filter((f) => f.endsWith(".md")).sort()
    : [];
  let nextNum = 1;
  if (existing.length > 0) {
    const lastFile = existing[existing.length - 1];
    const match = lastFile.match(/^(\d+)-/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }

  const date = new Date().toISOString().split("T")[0];
  const shortId = note.sessionId.slice(0, 8);
  const filename = `${String(nextNum).padStart(3, "0")}-${date}-${shortId}.md`;
  const tagsStr = note.tags.map((t) => t.trim()).join(", ");

  const fileContent = [
    "---",
    `session: ${note.sessionId}`,
    `sessionName: ${note.sessionName}`,
    `date: ${date}`,
    `tags: [${tagsStr}]`,
    "---",
    "",
    note.content,
    "",
  ].join("\n");

  writeFileSync(join(NOTES_DIR, filename), fileContent);

  return {
    id: nextNum,
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

  if (!existsSync(NOTES_DIR)) return [];

  const files = readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  // Read from newest first
  const notes: AgentNote[] = [];
  for (let i = files.length - 1; i >= 0 && notes.length < limit; i--) {
    const raw = readFileSync(join(NOTES_DIR, files[i]), "utf-8");
    const { data, content } = matter(raw);
    const noteTags = (data.tags as string[]) ?? [];

    // If tag filter is set, check for overlap
    if (filterTags && filterTags.length > 0) {
      const hasOverlap = noteTags.some((t) =>
        filterTags.some((ft) => t.toLowerCase().includes(ft))
      );
      if (!hasOverlap) continue;
    }

    const numMatch = files[i].match(/^(\d+)-/);
    notes.push({
      id: numMatch ? parseInt(numMatch[1], 10) : i,
      sessionId: (data.session as string) ?? "",
      sessionName: (data.sessionName as string) ?? "",
      date: (data.date as string) ?? "",
      tags: noteTags,
      content: content.trim(),
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

import fs from "fs";
import path from "path";
import type {
  ForgeState,
  ForgeSession,
  SessionSummary,
  KnowledgeTopic,
} from "./forge-types";

const FORGE_ROOT = path.join(process.cwd(), "packages", "forge");
const STATE_PATH = path.join(FORGE_ROOT, "forge-state.json");
const TOPICS_DIR = path.join(FORGE_ROOT, "src", "knowledge", "topics");
const NOTES_DIR = path.join(FORGE_ROOT, "src", "knowledge", "notes");
const LOGS_DIR = path.join(FORGE_ROOT, "logs");

/* ── State ──────────────────────────────────────────────── */

export function loadForgeState(): ForgeState | null {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(raw) as ForgeState;
  } catch {
    return null;
  }
}

export function getSessionSummaries(): SessionSummary[] {
  const state = loadForgeState();
  if (!state) return [];

  return state.sessions.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    focus: s.focus,
    players: s.players,
    experimentCount: s.experiments.length,
    oracleCount: s.oracleConsultations.length,
    totalCostUsd: s.totalCostUsd,
    totalInputTokens: s.totalInputTokens,
    totalOutputTokens: s.totalOutputTokens,
    bestCompositeScore: s.bestResult?.compositeScore ?? null,
    worktreeBranch: s.worktreeBranch,
  }));
}

export function getSession(id: string): Omit<ForgeSession, "conversationHistory"> | null {
  const state = loadForgeState();
  if (!state) return null;

  const session = state.sessions.find((s) => s.id === id);
  if (!session) return null;

  // Strip conversationHistory (large, only needed for agent resume)
  const { conversationHistory: _, ...rest } = session;
  return rest;
}

/* ── Experiment Logs ────────────────────────────────────── */

export function getSessionLogs(
  sessionName: string
): { filename: string; content: string }[] {
  const dir = path.join(LOGS_DIR, sessionName);
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    return files.map((f) => ({
      filename: f,
      content: fs.readFileSync(path.join(dir, f), "utf-8"),
    }));
  } catch {
    return [];
  }
}

/* ── Console Logs ──────────────────────────────────────── */

export function getConsoleLogPath(sessionName: string): string | null {
  const p = path.join(LOGS_DIR, sessionName, "console.jsonl");
  return fs.existsSync(p) ? p : null;
}

/* ── Knowledge ──────────────────────────────────────────── */

function parseFrontmatter(raw: string): {
  meta: Record<string, string | string[]>;
  content: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };

  const meta: Record<string, string | string[]> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Parse simple YAML arrays: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim());
    } else {
      meta[key] = value;
    }
  }
  return { meta, content: match[2] };
}

function readMarkdownDir(dir: string): { id: string; raw: string }[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => ({
        id: f.replace(/\.md$/, ""),
        raw: fs.readFileSync(path.join(dir, f), "utf-8"),
      }));
  } catch {
    return [];
  }
}

export function loadKnowledgeTopics(): KnowledgeTopic[] {
  return readMarkdownDir(TOPICS_DIR).map(({ id, raw }) => {
    const { meta, content } = parseFrontmatter(raw);
    return {
      id,
      topic: (meta.topic as string) || id,
      relevance: Array.isArray(meta.relevance)
        ? meta.relevance
        : typeof meta.relevance === "string"
          ? [meta.relevance]
          : [],
      updated: (meta.updated as string) || "",
      content,
    };
  });
}

export function loadAgentNotes(): KnowledgeTopic[] {
  return readMarkdownDir(NOTES_DIR).map(({ id, raw }) => {
    const { meta, content } = parseFrontmatter(raw);
    return {
      id,
      topic: (meta.topic as string) || id,
      relevance: Array.isArray(meta.relevance)
        ? meta.relevance
        : typeof meta.relevance === "string"
          ? [meta.relevance]
          : [],
      updated: (meta.updated as string) || "",
      content,
    };
  });
}

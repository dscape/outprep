import fs from "fs";
import path from "path";
import type {
  ForgeState,
  ForgeSession,
  SessionSummary,
  KnowledgeTopic,
} from "./forge-types";

const FORGE_ROOT = process.env.FORGE_DATA_DIR || path.join(process.cwd(), "packages", "forge");
const STATE_PATH = path.join(FORGE_ROOT, "forge-state.json");
const PIDS_DIR = path.join(FORGE_ROOT, ".pids");
const TOPICS_DIR = path.join(FORGE_ROOT, "src", "knowledge", "topics");
const NOTES_DIR = path.join(FORGE_ROOT, "src", "knowledge", "notes");
const LOGS_DIR = path.join(FORGE_ROOT, "logs");
const GAMES_DIR = path.join(FORGE_ROOT, "data", "games");

/* ── State ──────────────────────────────────────────────── */

export function isForgeAvailable(): boolean {
  return fs.existsSync(STATE_PATH);
}

export function loadForgeState(): ForgeState | null {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(raw) as ForgeState;
  } catch {
    if (!fs.existsSync(STATE_PATH)) {
      console.warn(`[forge] forge-state.json not found at ${STATE_PATH}`);
    }
    return null;
  }
}

/**
 * Check if a forge agent process is actually running via PID file.
 */
function isAgentRunning(sessionId: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(PIDS_DIR, `${sessionId}.pid`), "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (!Number.isFinite(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getSessionSummaries(): SessionSummary[] {
  const state = loadForgeState();
  if (!state) return [];

  return state.sessions.map((s) => {
    const running = isAgentRunning(s.id);
    // If state says "active" but no process is alive, it's actually paused
    const status = s.status === "active" && !running ? "paused" : s.status;
    return {
      id: s.id,
      name: s.name,
      status,
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
      isRunning: running,
    };
  });
}

export function getSession(id: string): (Omit<ForgeSession, "conversationHistory"> & { isRunning: boolean }) | null {
  const state = loadForgeState();
  if (!state) return null;

  const session = state.sessions.find((s) => s.id === id);
  if (!session) return null;

  const running = isAgentRunning(session.id);
  const status = session.status === "active" && !running ? "paused" : session.status;

  // Strip conversationHistory (large, only needed for agent resume)
  const { conversationHistory: _, ...rest } = session;
  return { ...rest, status, isRunning: running };
}

/**
 * If a session is still marked "active" in state but its process has exited,
 * patch it to "paused" so the UI shows the correct controls.
 */
export function markSessionPausedIfActive(nameOrId: string): void {
  const state = loadForgeState();
  if (!state) return;
  const session = state.sessions.find(
    (s) => (s.id === nameOrId || s.name === nameOrId) && s.status === "active"
  );
  if (!session) return;
  session.status = "paused";
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
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

/* ── Game Data ─────────────────────────────────────────── */

export interface PlayerMeta {
  username: string;
  estimatedElo: number;
  gameCount: number;
  contentHash: string;
  fetchedAt: string;
}

export function listGamePlayers(): PlayerMeta[] {
  try {
    const files = fs.readdirSync(GAMES_DIR).filter((f) => f.endsWith(".meta.json"));
    return files.map((f) => {
      const raw = fs.readFileSync(path.join(GAMES_DIR, f), "utf-8");
      return JSON.parse(raw) as PlayerMeta;
    });
  } catch {
    return [];
  }
}

export function getPlayerGames(
  username: string,
  page = 1,
  limit = 50
): { games: unknown[]; total: number } {
  try {
    const raw = fs.readFileSync(path.join(GAMES_DIR, `${username.toLowerCase()}.json`), "utf-8");
    const allGames = JSON.parse(raw) as unknown[];
    const start = (page - 1) * limit;
    return {
      games: allGames.slice(start, start + limit),
      total: allGames.length,
    };
  } catch {
    return { games: [], total: 0 };
  }
}

/* ── Activity Log ──────────────────────────────────────── */

export function buildActivityLog(
  session: Omit<ForgeSession, "conversationHistory">
): import("./forge-types").ActivityEvent[] {
  const events: import("./forge-types").ActivityEvent[] = [];

  for (const exp of session.experiments) {
    events.push({
      id: `exp-${exp.id}`,
      timestamp: exp.timestamp,
      type: "experiment",
      title: `Experiment #${exp.number}: ${exp.hypothesis.slice(0, 80)}`,
      detail: `${exp.conclusion} — composite delta ${exp.delta.compositeScore > 0 ? "+" : ""}${exp.delta.compositeScore.toFixed(3)}`,
      artifactId: exp.id,
      artifactType: "experiments",
      consoleTimestamp: exp.timestamp,
    });

    for (const cc of exp.codeChanges) {
      events.push({
        id: `cc-${cc.id}`,
        timestamp: cc.timestamp,
        type: "code-change",
        title: `Code change: ${cc.file}`,
        detail: cc.description,
        artifactId: cc.id,
        artifactType: "changes",
        consoleTimestamp: cc.timestamp,
      });
    }
  }

  for (const o of session.oracleConsultations) {
    events.push({
      id: `oracle-${o.id}`,
      timestamp: o.timestamp,
      type: "oracle",
      title: `Oracle: ${o.question.slice(0, 80)}`,
      detail: `Confidence: ${o.confidence}`,
      artifactId: o.id,
      artifactType: "oracle",
      consoleTimestamp: o.timestamp,
    });
  }

  for (const cc of session.activeChanges) {
    if (!events.some((e) => e.id === `cc-${cc.id}`)) {
      events.push({
        id: `cc-${cc.id}`,
        timestamp: cc.timestamp,
        type: "code-change",
        title: `Active change: ${cc.file}`,
        detail: cc.description,
        artifactId: cc.id,
        artifactType: "changes",
        consoleTimestamp: cc.timestamp,
      });
    }
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return events;
}

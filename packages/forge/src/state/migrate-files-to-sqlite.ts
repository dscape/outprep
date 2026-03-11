#!/usr/bin/env npx tsx
/**
 * One-time migration: moves knowledge topics, knowledge notes,
 * console logs (JSONL), and research logs (markdown) from files
 * into the forge SQLite database.
 *
 * Usage:
 *   npx tsx packages/forge/src/state/migrate-files-to-sqlite.ts [backup-dir]
 *
 * If backup-dir is given, reads from there; otherwise reads from the
 * standard locations under packages/forge/.
 */

import { getForgeDb } from "./forge-db";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORGE_ROOT = join(__dirname, "..", "..");

function main() {
  const backupDir = process.argv[2]; // optional /tmp/forge-backup

  const topicsDir = backupDir ? join(backupDir, "topics") : join(FORGE_ROOT, "src", "knowledge", "topics");
  const notesDir  = backupDir ? join(backupDir, "notes")  : join(FORGE_ROOT, "src", "knowledge", "notes");
  const logsDir   = backupDir ? join(backupDir, "logs")   : join(FORGE_ROOT, "logs");
  // games are already in SQLite, skip

  const db = getForgeDb();

  // ── Knowledge Topics ──────────────────────────────────
  if (existsSync(topicsDir)) {
    const files = readdirSync(topicsDir).filter(f => f.endsWith(".md"));
    const insert = db.prepare(`
      INSERT OR REPLACE INTO knowledge_topics (id, title, relevance, updated, content)
      VALUES (?, ?, ?, ?, ?)
    `);

    let count = 0;
    for (const f of files) {
      const raw = readFileSync(join(topicsDir, f), "utf-8");
      const { data, content } = matter(raw);
      const id = f.replace(/\.md$/, "");
      const relevance = Array.isArray(data.relevance) ? data.relevance : [];
      insert.run(
        id,
        String(data.topic ?? id),
        JSON.stringify(relevance),
        String(data.updated ?? ""),
        content.trim(),
      );
      count++;
    }
    console.log(`  ✓ Migrated ${count} knowledge topics`);
  } else {
    console.log(`  · No topics dir found at ${topicsDir}`);
  }

  // ── Knowledge Notes ───────────────────────────────────
  if (existsSync(notesDir)) {
    const files = readdirSync(notesDir).filter(f => f.endsWith(".md")).sort();
    const insert = db.prepare(`
      INSERT OR REPLACE INTO knowledge_notes (id, session_id, session_name, date, tags, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let count = 0;
    for (const f of files) {
      const raw = readFileSync(join(notesDir, f), "utf-8");
      const { data, content } = matter(raw);
      const numMatch = f.match(/^(\d+)-/);
      const id = numMatch ? parseInt(numMatch[1], 10) : count + 1;
      const tags = Array.isArray(data.tags) ? data.tags : [];
      insert.run(
        id,
        String(data.session ?? ""),
        String(data.sessionName ?? ""),
        String(data.date ?? ""),
        JSON.stringify(tags),
        content.trim(),
      );
      count++;
    }
    console.log(`  ✓ Migrated ${count} knowledge notes`);
  } else {
    console.log(`  · No notes dir found at ${notesDir}`);
  }

  // ── Console Logs (JSONL) ──────────────────────────────
  // Also need session name → session id mapping
  const sessions: { id: string; name: string }[] = db
    .prepare("SELECT id, name FROM sessions")
    .all() as any[];
  const nameToId = new Map(sessions.map(s => [s.name, s.id]));

  if (existsSync(logsDir)) {
    const sessionDirs = readdirSync(logsDir).filter(d => {
      try { return readdirSync(join(logsDir, d)).length > 0; } catch { return false; }
    });

    const insertConsole = db.prepare(`
      INSERT INTO console_logs (session_id, timestamp, level, message)
      VALUES (?, ?, ?, ?)
    `);

    const insertResearch = db.prepare(`
      INSERT INTO research_logs (session_id, session_name, timestamp, level, message)
      VALUES (?, ?, ?, ?, ?)
    `);

    let consoleCount = 0;
    let researchCount = 0;

    for (const sessionName of sessionDirs) {
      const sessionId = nameToId.get(sessionName);
      if (!sessionId) {
        console.log(`  · Skipping logs for "${sessionName}" (no matching session)`);
        continue;
      }

      const sessionDir = join(logsDir, sessionName);

      // Console JSONL
      const jsonlPath = join(sessionDir, "console.jsonl");
      if (existsSync(jsonlPath)) {
        const raw = readFileSync(jsonlPath, "utf-8");
        const lines = raw.split("\n").filter(Boolean);

        const insertMany = db.transaction((entries: { ts: string; level: string; msg: string }[]) => {
          for (const e of entries) {
            insertConsole.run(sessionId, e.ts, e.level, e.msg);
          }
        });

        const entries: { ts: string; level: string; msg: string }[] = [];
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            entries.push({
              ts: parsed.ts ?? new Date().toISOString(),
              level: parsed.level ?? "info",
              msg: parsed.msg ?? line,
            });
          } catch {
            // Unparseable line — store raw
            entries.push({ ts: new Date().toISOString(), level: "info", msg: line });
          }
        }
        insertMany(entries);
        consoleCount += entries.length;
      }

      // Research log markdown files
      const mdFiles = readdirSync(sessionDir).filter(f => f.endsWith(".md")).sort();
      for (const f of mdFiles) {
        const raw = readFileSync(join(sessionDir, f), "utf-8");
        // Extract timestamp from filename if possible (e.g., experiment-001.md)
        const ts = new Date().toISOString();
        insertResearch.run(sessionId, sessionName, ts, "info", raw);
        researchCount++;
      }
    }

    console.log(`  ✓ Migrated ${consoleCount} console log entries`);
    console.log(`  ✓ Migrated ${researchCount} research log files`);
  } else {
    console.log(`  · No logs dir found at ${logsDir}`);
  }

  console.log("\n  Migration complete.\n");
}

main();

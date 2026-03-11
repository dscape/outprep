/**
 * Log writer — dual-writes to JSONL files and SQLite.
 *
 * JSONL files are kept for backward compatibility with the
 * EventSource-based console log streaming API.
 * SQLite is the primary store for querying and persistence.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { getForgeDb } from "../state/forge-db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, "..", "..", "logs");

export interface LogWriter {
  log(message: string, level?: "info" | "warn" | "error"): void;
  close(): void;
}

/**
 * Create a log writer that writes to both JSONL and SQLite.
 *
 * @param sessionName — session name for the JSONL file path
 * @param sessionId — optional session ID for SQLite writes
 */
export function createLogWriter(
  sessionName: string,
  sessionId?: string
): LogWriter {
  // JSONL file output (kept for console streaming API compatibility)
  const dir = path.join(LOGS_DIR, sessionName);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, "console.jsonl");
  const fd = fs.openSync(filePath, "a");

  let db: ReturnType<typeof getForgeDb> | null = null;
  let insertStmt: any = null;

  function ensureDb() {
    if (db) return db;
    try {
      db = getForgeDb();
      insertStmt = db!.prepare(
        `INSERT INTO console_logs (session_id, timestamp, level, message) VALUES (?, ?, ?, ?)`
      );
    } catch {
      // SQLite not available — JSONL only
    }
    return db;
  }

  return {
    log(message: string, level: "info" | "warn" | "error" = "info") {
      const ts = new Date().toISOString();
      const entry = JSON.stringify({ ts, level, msg: message });

      // Write to JSONL
      fs.writeSync(fd, entry + "\n");

      // Write to SQLite if session ID is known
      if (sessionId) {
        try {
          ensureDb();
          insertStmt?.run(sessionId, ts, level, message);
        } catch {
          // SQLite write failed — JSONL is the fallback
        }
      }
    },
    close() {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed
      }
    },
  };
}

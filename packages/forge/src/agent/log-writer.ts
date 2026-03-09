import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, "..", "..", "logs");

export interface LogWriter {
  log(message: string, level?: "info" | "warn" | "error"): void;
  close(): void;
}

export function createLogWriter(sessionName: string): LogWriter {
  const dir = path.join(LOGS_DIR, sessionName);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, "console.jsonl");
  const fd = fs.openSync(filePath, "a");

  return {
    log(message: string, level: "info" | "warn" | "error" = "info") {
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg: message,
      });
      fs.writeSync(fd, entry + "\n");
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

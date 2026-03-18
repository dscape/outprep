import { NextRequest, NextResponse } from "next/server";
import { getSession, getConsoleLogSessionId } from "@/lib/forge";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { sessionId } = await params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const hasLogs = getConsoleLogSessionId(session.id);
  if (!hasLogs) {
    return NextResponse.json({ error: "no console logs" }, { status: 404 });
  }

  // offset = last seen row ID (0 = start from beginning)
  const offset = parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10);
  const isActive = session.isRunning || session.status === "active";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const Database = require("better-sqlite3");

      // Read existing content from offset
      let lastId = offset;
      try {
        const db = new Database(
          require("path").join(
            process.env.FORGE_DATA_DIR || process.cwd(),
            "forge.db"
          ),
          { readonly: true }
        );

        const rows = db.prepare(
          "SELECT id, timestamp, level, message FROM console_logs WHERE session_id = ? AND id > ? ORDER BY id"
        ).all(session.id, lastId) as { id: number; timestamp: string; level: string; message: string }[];

        db.close();

        for (const row of rows) {
          send(JSON.stringify({ ts: row.timestamp, level: row.level, msg: row.message }));
          lastId = row.id;
        }
      } catch {
        // DB may not exist yet
      }

      if (!isActive) {
        // For completed sessions, send done and close
        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
        controller.enqueue(encoder.encode(`event: offset\ndata: ${lastId}\n\n`));
        controller.close();
        return;
      }

      // For active sessions, poll for new content
      const interval = setInterval(() => {
        try {
          const db = new Database(
            require("path").join(
              process.env.FORGE_DATA_DIR || process.cwd(),
              "forge.db"
            ),
            { readonly: true }
          );

          const rows = db.prepare(
            "SELECT id, timestamp, level, message FROM console_logs WHERE session_id = ? AND id > ? ORDER BY id"
          ).all(session.id, lastId) as { id: number; timestamp: string; level: string; message: string }[];

          db.close();

          for (const row of rows) {
            send(JSON.stringify({ ts: row.timestamp, level: row.level, msg: row.message }));
            lastId = row.id;
          }

          // Re-check session status
          const freshSession = getSession(sessionId);
          if (!freshSession || (!freshSession.isRunning && freshSession.status !== "active")) {
            controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
            controller.enqueue(encoder.encode(`event: offset\ndata: ${lastId}\n\n`));
            clearInterval(interval);
            controller.close();
          }
        } catch {
          clearInterval(interval);
          controller.close();
        }
      }, 500);

      // Cleanup on cancel
      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

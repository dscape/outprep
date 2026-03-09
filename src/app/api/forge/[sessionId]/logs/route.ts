import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { getSession, getConsoleLogPath } from "@/lib/forge";

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

  const logPath = getConsoleLogPath(session.name);
  if (!logPath) {
    return NextResponse.json({ error: "no console logs" }, { status: 404 });
  }

  const offset = parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10);
  const isActive = session.status === "active";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      // Read existing content from offset
      let currentOffset = offset;
      try {
        const stat = fs.statSync(logPath);
        if (stat.size > currentOffset) {
          const buf = Buffer.alloc(stat.size - currentOffset);
          const fd = fs.openSync(logPath, "r");
          fs.readSync(fd, buf, 0, buf.length, currentOffset);
          fs.closeSync(fd);
          currentOffset = stat.size;

          const lines = buf.toString("utf-8").split("\n").filter(Boolean);
          for (const line of lines) {
            send(line);
          }
        }
      } catch {
        // file may not exist yet
      }

      if (!isActive) {
        // For completed sessions, send done and close
        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
        controller.enqueue(encoder.encode(`event: offset\ndata: ${currentOffset}\n\n`));
        controller.close();
        return;
      }

      // For active sessions, poll for new content
      const interval = setInterval(() => {
        try {
          const stat = fs.statSync(logPath);
          if (stat.size > currentOffset) {
            const buf = Buffer.alloc(stat.size - currentOffset);
            const fd = fs.openSync(logPath, "r");
            fs.readSync(fd, buf, 0, buf.length, currentOffset);
            fs.closeSync(fd);
            currentOffset = stat.size;

            const lines = buf.toString("utf-8").split("\n").filter(Boolean);
            for (const line of lines) {
              send(line);
            }
          }

          // Re-check session status
          const freshSession = getSession(sessionId);
          if (!freshSession || freshSession.status !== "active") {
            controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
            controller.enqueue(encoder.encode(`event: offset\ndata: ${currentOffset}\n\n`));
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

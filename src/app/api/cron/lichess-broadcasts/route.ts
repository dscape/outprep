/**
 * Vercel Cron: Daily Lichess broadcast ingestion.
 * Schedule: Every day at 8am UTC (configured in vercel.json)
 *
 * Discovers new broadcasts, fetches round PGNs, and upserts
 * games with 4-layer deduplication. Time-budgeted to 4.5 minutes.
 */

import { NextRequest } from "next/server";
import { processLichessBroadcasts } from "@/lib/pipeline/lichess-broadcasts";

export const maxDuration = 300; // 5 minutes (Pro plan)

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processLichessBroadcasts();

    return Response.json({
      status: result.auditWarnings.length === 0 ? "ok" : "ok_with_warnings",
      ...result.discovery,
      ...result.ingestion,
      auditWarnings: result.auditWarnings,
      durationMs: result.durationMs,
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

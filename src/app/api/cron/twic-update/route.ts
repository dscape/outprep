/**
 * Vercel Cron: Weekly TWIC update.
 * Schedule: Every Monday at 6am UTC (configured in vercel.json)
 *
 * Downloads new TWIC issues, parses PGN in memory, and upserts
 * games + player stats directly to Postgres.
 */

import { NextRequest } from "next/server";
import {
  processIncrementalTwic,
  getLastProcessedIssue,
} from "@/lib/pipeline/twic-incremental";

export const maxDuration = 300; // 5 minutes (Pro plan)

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const lastIssue = await getLastProcessedIssue();

    const result = await processIncrementalTwic(5);

    const hasErrors = result.errors.length > 0;

    // Ping healthchecks.io on success so we know the cron ran
    if (!hasErrors && process.env.HEALTHCHECKS_TWIC_URL) {
      fetch(process.env.HEALTHCHECKS_TWIC_URL).catch(() => {});
    }

    return Response.json(
      {
        status: hasErrors ? "error" : "ok",
        previousLastIssue: lastIssue,
        newLastIssue: lastIssue
          ? lastIssue + result.issuesProcessed
          : lastIssue,
        ...result,
      },
      { status: hasErrors ? 500 : 200 },
    );
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

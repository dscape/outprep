/**
 * Vercel Cron: Daily TWIC update.
 * Schedule: Daily at 6am UTC (configured in vercel.json)
 *
 * Downloads one new TWIC issue, then updates games, player stats,
 * and tournament events directly in Postgres.
 */

import { revalidatePath } from "next/cache";
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

    // One issue per invocation keeps the full transaction within Vercel's limit.
    const result = await processIncrementalTwic(1);

    const hasErrors = result.errors.length > 0;
    if (!hasErrors && (result.issuesProcessed > 0 || result.gamesLinked > 0)) {
      revalidatePath("/");
    }

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

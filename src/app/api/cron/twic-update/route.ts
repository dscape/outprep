/**
 * Vercel Cron: Weekly TWIC update.
 * Schedule: Every Monday at 6am UTC (configured in vercel.json)
 *
 * 1. Queries pipeline_runs for the last processed TWIC issue
 * 2. Checks if new issues are available
 * 3. Triggers the incremental pipeline for new issues
 *
 * Note: The actual heavy processing (download + parse + upsert) happens
 * in this route handler. For datasets that exceed the function timeout,
 * consider moving to a Vercel Background Function.
 */

import { NextRequest } from "next/server";
import { sql } from "@/lib/db/connection";

export const maxDuration = 300; // 5 minutes (Pro plan)

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find the last successfully processed TWIC issue
    const { rows } = await sql`
      SELECT identifier FROM pipeline_runs
      WHERE run_type = 'twic' AND status = 'completed'
      ORDER BY identifier::int DESC
      LIMIT 1
    `;

    const lastIssue = rows.length > 0 ? parseInt(rows[0].identifier as string) : null;

    return Response.json({
      status: "ok",
      lastProcessedIssue: lastIssue,
      message: lastIssue
        ? `Last processed TWIC issue: ${lastIssue}. Incremental pipeline not yet implemented in this route — run manually with: npm run fide-pipeline -- upload-pg`
        : "No TWIC issues processed yet. Run the full pipeline first.",
    });
  } catch (error) {
    return Response.json(
      { error: String(error) },
      { status: 500 },
    );
  }
}

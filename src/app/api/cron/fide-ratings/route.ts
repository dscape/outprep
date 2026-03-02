/**
 * Vercel Cron: Monthly FIDE ratings update.
 * Schedule: 1st of each month at 6am UTC (configured in vercel.json)
 *
 * 1. Downloads the latest FIDE unified rating list (~295MB)
 * 2. Parses fixed-width format for all ~1M players
 * 3. Updates standard/rapid/blitz ratings for all matched players in Postgres
 * 4. Also updates names, federations, and titles if FIDE data changed
 *
 * Note: This is a heavy operation. Uses Vercel Background Function
 * with 5-minute timeout on Pro plan.
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
    // Find the last FIDE ratings update
    const { rows } = await sql`
      SELECT identifier, completed_at FROM pipeline_runs
      WHERE run_type = 'fide_ratings' AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 1
    `;

    const lastUpdate = rows.length > 0
      ? { date: rows[0].identifier as string, completedAt: rows[0].completed_at as string }
      : null;

    return Response.json({
      status: "ok",
      lastUpdate,
      message: lastUpdate
        ? `Last FIDE ratings update: ${lastUpdate.date}. Automated monthly update not yet implemented in this route — run manually with: npm run fide-pipeline -- process && npm run fide-pipeline -- upload-pg`
        : "No FIDE ratings updates recorded. Run the full pipeline first.",
    });
  } catch (error) {
    return Response.json(
      { error: String(error) },
      { status: 500 },
    );
  }
}

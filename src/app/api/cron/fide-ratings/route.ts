/**
 * Vercel Cron: Monthly FIDE ratings update.
 * Schedule: 1st of each month at 6am UTC (configured in vercel.json)
 *
 * Downloads the FIDE unified rating list (~295MB), parses in memory,
 * and batch-updates standard/rapid/blitz ratings for all matched players.
 */

import { NextRequest } from "next/server";
import {
  updateFideRatings,
  getLastFideUpdate,
} from "@/lib/pipeline/fide-ratings-update";

export const maxDuration = 300; // 5 minutes (Pro plan)

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const lastUpdate = await getLastFideUpdate();

    const result = await updateFideRatings();

    return Response.json({
      status: result.errors.length === 0 ? "ok" : "partial",
      previousUpdate: lastUpdate,
      ...result,
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

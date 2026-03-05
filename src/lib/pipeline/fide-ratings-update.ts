/**
 * Lightweight FIDE ratings update for serverless execution.
 *
 * Downloads the official FIDE rating list (~40MB zip, ~295MB extracted),
 * parses the fixed-width format in memory, and batch-updates ratings
 * for all players in our database.
 *
 * FIDE TXT column layout (players_list_foa.txt):
 *   Cols 0-14:    FIDE ID
 *   Cols 15-75:   Name
 *   Cols 76-78:   Federation
 *   Cols 84-87:   Title
 *   Cols 113-117: Standard Rating
 *   Cols 126-130: Rapid Rating
 *   Cols 139-143: Blitz Rating
 *   Cols 152-155: Birth year
 */

import { sql } from "@/lib/db/connection";
import { downloadAndExtractFideRatings } from "./pgn-extract";

interface FideRatingRecord {
  fideId: string;
  name: string;
  federation: string;
  title: string | null;
  birthYear: number | null;
  standardRating: number | null;
  rapidRating: number | null;
  blitzRating: number | null;
}

/**
 * Parse the FIDE fixed-width text, filtering to only FIDE IDs we care about.
 */
function parseFideText(
  text: string,
  filterIds: Set<string>,
): FideRatingRecord[] {
  const records: FideRatingRecord[] = [];
  const lines = text.split("\n");

  // Skip header line (line 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 145) continue;

    const fideId = line.slice(0, 15).trim();
    if (!fideId || !/^\d+$/.test(fideId)) continue;
    if (!filterIds.has(fideId)) continue;

    const name = line.slice(15, 76).trim();
    const federation = line.slice(76, 79).trim();
    const title = line.slice(84, 88).trim() || null;

    const sRtng = parseInt(line.slice(113, 119).trim(), 10);
    const rRtng = parseInt(line.slice(126, 132).trim(), 10);
    const bRtng = parseInt(line.slice(139, 145).trim(), 10);
    const birthStr = line.slice(152, 156).trim();
    const birthYear = birthStr ? parseInt(birthStr, 10) : null;

    records.push({
      fideId,
      name,
      federation,
      title,
      birthYear: birthYear && !isNaN(birthYear) ? birthYear : null,
      standardRating: sRtng && !isNaN(sRtng) ? sRtng : null,
      rapidRating: rRtng && !isNaN(rRtng) ? rRtng : null,
      blitzRating: bRtng && !isNaN(bRtng) ? bRtng : null,
    });
  }

  return records;
}

/**
 * Get the last FIDE ratings update date.
 */
export async function getLastFideUpdate(): Promise<{
  date: string;
  completedAt: string;
} | null> {
  const { rows } = await sql`
    SELECT identifier, completed_at FROM pipeline_runs
    WHERE run_type = 'fide_ratings' AND status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 1
  `;
  return rows.length > 0
    ? {
        date: rows[0].identifier as string,
        completedAt: rows[0].completed_at as string,
      }
    : null;
}

/**
 * Download the FIDE rating list and update all matching players in Postgres.
 */
export async function updateFideRatings(): Promise<{
  playersChecked: number;
  playersUpdated: number;
  errors: string[];
}> {
  const errors: string[] = [];

  // 1. Get all FIDE IDs from our database
  const { rows: playerRows } = await sql`SELECT fide_id FROM players`;
  const ourFideIds = new Set(playerRows.map((r) => r.fide_id as string));

  if (ourFideIds.size === 0) {
    return {
      playersChecked: 0,
      playersUpdated: 0,
      errors: [
        "No players in database. Run the full pipeline first.",
      ],
    };
  }

  // 2. Download and extract FIDE ratings file in memory
  const fideText = await downloadAndExtractFideRatings();
  if (!fideText) {
    return {
      playersChecked: ourFideIds.size,
      playersUpdated: 0,
      errors: ["Failed to download FIDE rating list"],
    };
  }

  // 3. Parse, filtering to only our players
  const records = parseFideText(fideText, ourFideIds);

  // 4. Batch-update ratings
  let updated = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    for (const rec of batch) {
      try {
        const result = await sql`
          UPDATE players SET
            standard_rating = COALESCE(${rec.standardRating}, standard_rating),
            rapid_rating = COALESCE(${rec.rapidRating}, rapid_rating),
            blitz_rating = COALESCE(${rec.blitzRating}, blitz_rating),
            fide_rating = COALESCE(${rec.standardRating}, ${rec.rapidRating}, ${rec.blitzRating}, fide_rating),
            title = COALESCE(${rec.title}, title),
            federation = COALESCE(${rec.federation}, federation),
            birth_year = COALESCE(${rec.birthYear}, birth_year),
            updated_at = NOW()
          WHERE fide_id = ${rec.fideId}
        `;
        if (result.rows !== undefined) updated++;
      } catch (e) {
        errors.push(`Failed to update ${rec.fideId}: ${String(e)}`);
      }
    }
  }

  // 5. Record pipeline run
  const today = new Date().toISOString().split("T")[0];
  await sql`
    INSERT INTO pipeline_runs (run_type, identifier, status, completed_at, metadata)
    VALUES ('fide_ratings', ${today}, 'completed', NOW(), ${JSON.stringify({ playersUpdated: updated, totalRecords: records.length })}::jsonb)
    ON CONFLICT (run_type, identifier) DO UPDATE SET
      status = 'completed',
      completed_at = NOW(),
      metadata = ${JSON.stringify({ playersUpdated: updated, totalRecords: records.length })}::jsonb
  `;

  return {
    playersChecked: ourFideIds.size,
    playersUpdated: updated,
    errors,
  };
}

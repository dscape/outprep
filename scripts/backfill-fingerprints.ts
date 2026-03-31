/**
 * One-time fingerprint backfill for existing games.
 *
 * Computes content_fingerprint and move_count for all existing games
 * that don't have them yet. Also sets source='twic' for legacy games.
 *
 * This MUST run after migration 002-lichess-broadcasts.sql and
 * BEFORE any Lichess ingestion, so that cross-source dedup works.
 *
 * Usage:
 *   npx tsx scripts/backfill-fingerprints.ts
 *
 * Requires DATABASE_URL in .env.
 */

import { sql, closeSql } from "@/lib/db/connection";
import {
  extractMoveText,
  normalizeMoves,
  computeFingerprint,
  countMoves,
} from "@/lib/pipeline/lichess-broadcasts";

const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;

async function main() {
  console.log("=== Fingerprint Backfill ===\n");

  // Count total games needing backfill
  const { rows: countRows } = await sql`
    SELECT COUNT(*)::int AS count FROM games
    WHERE content_fingerprint IS NULL
  `;
  const total = countRows[0]?.count as number;
  console.log(`Games needing fingerprint: ${total}`);

  if (total === 0) {
    console.log("Nothing to do.");
    await closeSql();
    return;
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  const t0 = Date.now();
  let lastId = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Fetch next batch of games without fingerprints
    const { rows: games } = await sql`
      SELECT id, pgn, date, white_fide_id, black_fide_id
      FROM games
      WHERE content_fingerprint IS NULL AND id > ${lastId}
      ORDER BY id ASC
      LIMIT ${PAGE_SIZE}
    `;

    if (games.length === 0) break;

    // Process and collect updates
    const updates: Array<{
      id: number;
      fingerprint: string;
      moveCount: number;
    }> = [];

    for (const game of games) {
      lastId = game.id as number;
      processed++;

      const pgn = game.pgn as string;
      if (!pgn) {
        skipped++;
        continue;
      }

      const dateStr = game.date
        ? new Date(game.date as string).toISOString().split("T")[0].replace(/-/g, ".")
        : null;
      const whiteFideId = (game.white_fide_id as string) || "0";
      const blackFideId = (game.black_fide_id as string) || "0";

      if (!dateStr) {
        skipped++;
        continue;
      }

      const moveText = extractMoveText(pgn);
      const normalized = normalizeMoves(moveText);
      const moveCountVal = countMoves(normalized);

      if (!normalized) {
        skipped++;
        continue;
      }

      const fingerprint = computeFingerprint(
        dateStr,
        whiteFideId,
        blackFideId,
        normalized,
      );

      updates.push({
        id: game.id as number,
        fingerprint,
        moveCount: moveCountVal,
      });
    }

    // Batch-update fingerprints
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      await sql`
        UPDATE games g SET
          content_fingerprint = u.fingerprint,
          move_count = u.move_count::smallint,
          source = COALESCE(g.source, 'twic')
        FROM unnest(
          ${batch.map((u) => u.id)}::int[],
          ${batch.map((u) => u.fingerprint)}::text[],
          ${batch.map((u) => u.moveCount)}::int[]
        ) AS u(id, fingerprint, move_count)
        WHERE g.id = u.id
      `;
      updated += batch.length;
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const rate = (processed / ((Date.now() - t0) / 1000)).toFixed(0);
    console.log(
      `Processed ${processed}/${total} (${updated} updated, ${skipped} skipped) — ${rate} games/s — ${elapsed}s elapsed`,
    );
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\nDone: ${processed} processed, ${updated} updated, ${skipped} skipped in ${elapsed}s`,
  );

  // Verify
  const { rows: verifyRows } = await sql`
    SELECT COUNT(*)::int AS count FROM games
    WHERE content_fingerprint IS NULL
  `;
  const remaining = verifyRows[0]?.count as number;
  if (remaining > 0) {
    console.warn(
      `WARNING: ${remaining} games still lack fingerprints (likely missing PGN or date)`,
    );
  } else {
    console.log("All games have fingerprints.");
  }

  await closeSql();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  closeSql().finally(() => process.exit(1));
});

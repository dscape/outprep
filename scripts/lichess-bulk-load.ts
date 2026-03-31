/**
 * One-time bulk load of Lichess broadcast PGN archives.
 *
 * Downloads yearly .pgn.zst files from database.lichess.org,
 * decompresses via zstd CLI, and stream-parses games into Postgres
 * using the same 4-layer dedup as the daily cron.
 *
 * Usage:
 *   npx tsx scripts/lichess-bulk-load.ts path/to/archive1.pgn.zst [more...]
 *
 * Prerequisites:
 *   - zstd CLI installed: brew install zstd
 *   - DATABASE_URL set in .env
 *   - Migration 002-lichess-broadcasts.sql applied
 *   - Fingerprint backfill completed (scripts/backfill-fingerprints.ts)
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { sql, closeSql } from "@/lib/db/connection";
import {
  parseBroadcastGames,
  upsertBroadcastGame,
  runDuplicateAudit,
} from "@/lib/pipeline/lichess-broadcasts";

async function processArchive(filePath: string): Promise<{
  gamesInserted: number;
  gamesUpdated: number;
  gamesSkipped: number;
  gamesParsed: number;
  broadcastIds: Set<string>;
}> {
  console.log(`\n=== Processing ${filePath} ===\n`);

  let gamesInserted = 0;
  let gamesUpdated = 0;
  let gamesSkipped = 0;
  let gamesParsed = 0;
  const broadcastIds = new Set<string>();
  const seenSlugs = new Map<string, number>();

  // Lookup player slugs in bulk (pre-cache)
  const playerSlugs = new Map<string, string>();
  console.log("Loading player slug cache...");
  let offset = 0;
  const PAGE_SIZE = 5000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rows } = await sql`
      SELECT fide_id, slug FROM players
      ORDER BY id
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `;
    if (rows.length === 0) break;
    for (const row of rows) {
      playerSlugs.set(row.fide_id as string, row.slug as string);
    }
    offset += PAGE_SIZE;
  }
  console.log(`Cached ${playerSlugs.size} player slugs`);

  // Decompress and stream-parse
  const zstd = spawn("zstd", ["-d", "-c", filePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  zstd.stderr.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[zstd] ${msg}`);
  });

  const rl = createInterface({
    input: zstd.stdout,
    crlfDelay: Infinity,
  });

  let currentGame: string[] = [];
  let inGame = false;
  const t0 = Date.now();

  async function flushGame(): Promise<void> {
    if (currentGame.length === 0) return;
    const pgnText = currentGame.join("\n");
    currentGame = [];

    const games = parseBroadcastGames(pgnText);
    for (const game of games) {
      gamesParsed++;

      if (game.broadcastUrl) {
        // Extract broadcast tournament ID from URL
        // e.g. https://lichess.org/broadcast/slug/round-slug/roundId
        const urlParts = game.broadcastUrl.split("/");
        // Tournament slug is at index 4 (after broadcast/)
        // But we need the tournament ID — it's in the GameURL or from the listing
        // For bulk load, track by broadcast name as fallback
      }
      if (game.roundId) {
        // Try to extract broadcast ID from BroadcastURL (two segments before roundId)
        if (game.broadcastUrl) {
          const parts = game.broadcastUrl.split("/");
          // URL: /broadcast/{tour-slug}/{round-slug}/{roundId}
          // The tour ID isn't in the URL — we need the broadcast name
          // Use the BroadcastName as a tracking key for bulk load
        }
      }

      const result = await upsertBroadcastGame(
        game,
        "bulk",
        playerSlugs,
        seenSlugs,
      );
      if (result === "inserted") gamesInserted++;
      else if (result === "updated") gamesUpdated++;
      else gamesSkipped++;

      if (gamesParsed % 1000 === 0) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(
          `  ${gamesParsed} games parsed (${gamesInserted} inserted, ${gamesUpdated} updated, ${gamesSkipped} skipped) in ${elapsed}s`,
        );
      }
    }
  }

  for await (const line of rl) {
    if (line.startsWith("[Event ")) {
      // Flush previous game
      if (inGame) {
        await flushGame();
      }
      inGame = true;
      currentGame = [line];
    } else if (inGame) {
      currentGame.push(line);
    }
  }
  // Flush last game
  if (inGame) {
    await flushGame();
  }

  // Wait for zstd to finish
  await new Promise<void>((resolve, reject) => {
    zstd.on("close", (code) => {
      if (code !== 0) reject(new Error(`zstd exited with code ${code}`));
      else resolve();
    });
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\nArchive complete: ${gamesParsed} parsed, ${gamesInserted} inserted, ${gamesUpdated} updated, ${gamesSkipped} skipped in ${elapsed}s`,
  );

  return { gamesInserted, gamesUpdated, gamesSkipped, gamesParsed, broadcastIds };
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error(
      "Usage: npx tsx scripts/lichess-bulk-load.ts <archive.pgn.zst> [more...]",
    );
    console.error(
      "\nDownload archives from https://database.lichess.org (Broadcast games section)",
    );
    process.exit(1);
  }

  console.log("=== Lichess Broadcast Bulk Load ===");
  console.log(`Files: ${files.join(", ")}`);

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalParsed = 0;

  for (const file of files) {
    const result = await processArchive(file);
    totalInserted += result.gamesInserted;
    totalUpdated += result.gamesUpdated;
    totalSkipped += result.gamesSkipped;
    totalParsed += result.gamesParsed;
  }

  // Run duplicate audit
  console.log("\n=== Post-load duplicate audit ===\n");
  const warnings = await runDuplicateAudit();
  if (warnings.length === 0) {
    console.log("No suspicious duplicates found.");
  } else {
    console.warn(`WARNING: ${warnings.length} suspicious duplicate groups:`);
    for (const w of warnings) {
      console.warn(
        `  ${w.date}: ${w.whiteFideId} vs ${w.blackFideId} → ${w.count} games`,
      );
    }
  }

  console.log("\n=== Summary ===\n");
  console.log(`Total parsed:   ${totalParsed}`);
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total updated:  ${totalUpdated}`);
  console.log(`Total skipped:  ${totalSkipped}`);

  await closeSql();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  closeSql().finally(() => process.exit(1));
});

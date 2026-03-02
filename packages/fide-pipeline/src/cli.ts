#!/usr/bin/env node

/**
 * FIDE pipeline CLI — download TWIC data, process players, upload to Vercel Blob.
 */

import { Command } from "commander";
import { downloadTWIC, downloadRange, downloadFideRatings } from "./download";
import { parseHeaders } from "./fast-parser";
import {
  aggregatePlayers,
  createAggregator,
  buildPlayerIndex,
  normalizePlayerName,
} from "./aggregate";
import { uploadAllFromDisk } from "./upload";
import {
  ensureSchema,
  upsertPlayers,
  upsertPlayerAliases,
  upsertGamesFromJsonl,
  upsertGameAliases,
  recordPipelineRun,
  completePipelineRun,
  failPipelineRun,
} from "./upload-pg";
import { loadFideData, enrichPlayers } from "./fide-enrichment";
import {
  buildGameDetails,
  buildGameIndex,
  buildGameAliasMap,
  buildPlayerRecentGames,
  buildPlayerNotableGames,
  createGameProcessingState,
  processGameDetailsChunk,
  finalizeGameProcessing,
} from "./game-indexer";
import type { TWICGameHeader, FIDEPlayer, GameIndex } from "./types";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, appendFileSync, openSync, writeSync, closeSync, unlinkSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

// ─── Load .env from project root ────────────────────────────────────────────
// Walk up from packages/fide-pipeline/ to find the root .env file.
// This avoids adding a dotenv dependency — just parse KEY=VALUE lines.
function loadEnvFile(): void {
  // Try root .env first, then .env.local
  const root = join(import.meta.dirname, "..", "..", "..");
  for (const name of [".env", ".env.local"]) {
    const envPath = join(root, name);
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      // Don't override existing env vars (e.g., from CI)
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

loadEnvFile();

const DATA_DIR = join(import.meta.dirname, "..", "data");
const PROCESSED_DIR = join(DATA_DIR, "processed");
const GAMES_DIR = join(PROCESSED_DIR, "games");
const GAME_DETAILS_JSONL = join(PROCESSED_DIR, "game-details.jsonl");
const GAME_DETAILS_DIR = join(PROCESSED_DIR, "game-details");
const RATINGS_DIR = join(DATA_DIR, "ratings");

function ensureDirs(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(PROCESSED_DIR)) mkdirSync(PROCESSED_DIR, { recursive: true });
  if (!existsSync(GAMES_DIR)) mkdirSync(GAMES_DIR, { recursive: true });
}

const program = new Command()
  .name("fide-pipeline")
  .description("Download TWIC data, process FIDE players, upload to Vercel Blob")
  .version("0.1.0");

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Build a map from alias slug → canonical slug for 301 redirects.
 */
function buildAliasMap(players: FIDEPlayer[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of players) {
    for (const alias of p.aliases) {
      map[alias] = p.slug;
    }
  }
  return map;
}

/**
 * Write per-player game files to disk, one JSON file per player.
 * This replaces the old in-memory buildPlayerGameMap + giant games.json approach.
 *
 * Iterates allGames once, collects PGNs per slug in memory (Map<slug, string[]>),
 * then flushes each player's file individually. This is much more memory-efficient
 * than serializing everything into one giant JSON object.
 *
 * Returns the number of game files written.
 */
function writePlayerGames(
  allGames: TWICGameHeader[],
  players: FIDEPlayer[],
  gamesDir: string
): number {
  // Build lookups: FIDE ID → slug (primary), normalized name → slug (fallback)
  const fideIdToSlug = new Map<string, string>();
  const nameToSlug = new Map<string, string>();
  for (const p of players) {
    if (p.fideId) {
      fideIdToSlug.set(p.fideId, p.slug);
    }
    nameToSlug.set(normalizePlayerName(p.name), p.slug);
  }

  // Collect games per player slug
  const gamesBySlug = new Map<string, string[]>();
  for (const p of players) {
    gamesBySlug.set(p.slug, []);
  }

  for (const game of allGames) {
    // Match white player: prefer FIDE ID, fall back to name
    const whiteSlug = (game.whiteFideId && fideIdToSlug.get(game.whiteFideId))
      || nameToSlug.get(normalizePlayerName(game.white));
    // Match black player: prefer FIDE ID, fall back to name
    const blackSlug = (game.blackFideId && fideIdToSlug.get(game.blackFideId))
      || nameToSlug.get(normalizePlayerName(game.black));

    if (whiteSlug && gamesBySlug.has(whiteSlug)) {
      gamesBySlug.get(whiteSlug)!.push(game.rawPgn);
    }
    if (blackSlug && gamesBySlug.has(blackSlug)) {
      gamesBySlug.get(blackSlug)!.push(game.rawPgn);
    }
  }

  // Clean old game files first to avoid stale slugs (e.g. f-caruana → fabiano-caruana)
  if (existsSync(gamesDir)) {
    rmSync(gamesDir, { recursive: true });
  }
  mkdirSync(gamesDir, { recursive: true });

  let written = 0;
  for (const [slug, pgns] of gamesBySlug) {
    if (pgns.length > 0) {
      writeFileSync(join(gamesDir, `${slug}.json`), JSON.stringify(pgns));
      written++;
    }
  }

  return written;
}

/**
 * Stream-write a JSON array to a file one element at a time to avoid
 * building the entire JSON string in memory (prevents OOM on large arrays).
 */
function streamWriteJsonArray(filePath: string, items: unknown[]): void {
  const fd = openSync(filePath, "w");
  writeSync(fd, "[");
  for (let i = 0; i < items.length; i++) {
    if (i > 0) writeSync(fd, ",");
    writeSync(fd, JSON.stringify(items[i]));
  }
  writeSync(fd, "]");
  closeSync(fd);
}

/**
 * Stream-write the GameIndex object — the `games` array is written element
 * by element so we never stringify the entire index at once.
 */
function streamWriteGameIndex(filePath: string, gameIndex: GameIndex): void {
  const fd = openSync(filePath, "w");
  writeSync(fd, `{"generatedAt":${JSON.stringify(gameIndex.generatedAt)},"totalGames":${gameIndex.totalGames},"games":[`);
  for (let i = 0; i < gameIndex.games.length; i++) {
    if (i > 0) writeSync(fd, ",");
    writeSync(fd, JSON.stringify(gameIndex.games[i]));
  }
  writeSync(fd, "]}");
  closeSync(fd);
}

/**
 * Stream-write a Record<string,string> as JSON one key at a time to avoid
 * building the entire string in memory.
 */
function streamWriteRecord(filePath: string, record: Record<string, string>): void {
  const fd = openSync(filePath, "w");
  writeSync(fd, "{");
  let first = true;
  for (const key of Object.keys(record)) {
    if (!first) writeSync(fd, ",");
    writeSync(fd, `${JSON.stringify(key)}:${JSON.stringify(record[key])}`);
    first = false;
  }
  writeSync(fd, "}");
  closeSync(fd);
}

/**
 * Stream-write game-index.json from a JSONL temp file of GameIndexEntry objects.
 * Reads one line at a time so the full index never lives in memory.
 */
async function streamWriteGameIndexFromJsonl(
  outputPath: string,
  jsonlPath: string,
  totalGames: number
): Promise<void> {
  const fd = openSync(outputPath, "w");
  writeSync(fd, `{"generatedAt":${JSON.stringify(new Date().toISOString())},"totalGames":${totalGames},"games":[`);

  const rl = createInterface({
    input: createReadStream(jsonlPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let first = true;
  for await (const line of rl) {
    if (!line) continue;
    if (!first) writeSync(fd, ",");
    writeSync(fd, line);
    first = false;
  }

  writeSync(fd, "]}");
  closeSync(fd);
}

/**
 * Stream-write game-aliases.json from a tab-separated JSONL temp file.
 * Each line is: legacySlug\tnewSlug
 * Returns the number of aliases written.
 */
async function streamWriteGameAliasesFromJsonl(
  outputPath: string,
  jsonlPath: string
): Promise<number> {
  const fd = openSync(outputPath, "w");
  writeSync(fd, "{");

  const rl = createInterface({
    input: createReadStream(jsonlPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let first = true;
  let count = 0;
  for await (const line of rl) {
    if (!line) continue;
    const tabIdx = line.indexOf("\t");
    if (tabIdx === -1) continue;
    if (!first) writeSync(fd, ",");
    writeSync(fd, `${JSON.stringify(line.slice(0, tabIdx))}:${JSON.stringify(line.slice(tabIdx + 1))}`);
    first = false;
    count++;
  }

  writeSync(fd, "}");
  closeSync(fd);
  return count;
}

/**
 * Two-pass pipeline: aggregate without rawPgn (low memory), then process
 * games one PGN file at a time with rawPgn. Prevents OOM on large datasets.
 */
async function processTwoPass(
  pgnFiles: { name: string; path: string }[],
  opts: { minGames: number; minElo: number }
) {
  // ── PASS 1: Parse without rawPgn, aggregate incrementally, enrich ──
  console.log("\nPass 1: Aggregate players (lightweight, no PGN text)...\n");

  const aggregator = createAggregator();
  let totalGames = 0;
  for (let fi = 0; fi < pgnFiles.length; fi++) {
    const file = pgnFiles[fi];
    const pct = Math.round(((fi + 1) / pgnFiles.length) * 100);
    process.stdout.write(`  [${fi + 1}/${pgnFiles.length} ${pct}%] ${file.name}: reading...`);
    const pgn = readFileSync(file.path, "utf-8");
    const start = Date.now();
    const games = parseHeaders(pgn, { skipRawPgn: true });
    const ms = Date.now() - start;
    process.stdout.write(`\r  [${fi + 1}/${pgnFiles.length} ${pct}%] ${file.name}: ${games.length} games (${ms}ms)\n`);
    aggregator.feed(games);
    totalGames += games.length;
    // games array freed at next iteration — no accumulation
  }
  console.log(`\nTotal games: ${totalGames}`);

  console.log("\nAggregating players...");
  const players = aggregator.finalize(opts.minGames);
  console.log(`  ${players.length} players with ${opts.minGames}+ games`);

  console.log("\nDownloading FIDE rating list (if needed)...");
  await downloadFideRatings();
  console.log("\nEnriching with FIDE rating list...");
  const playerFideIds = new Set(players.map((p) => p.fideId));
  let fideData = loadFideData(RATINGS_DIR, playerFideIds);
  const enrichedCount = enrichPlayers(players, fideData);
  console.log(`  Enriched ${enrichedCount}/${players.length} players`);
  players.sort((a, b) => b.fideRating - a.fideRating);

  // Free FIDE data before Pass 2
  fideData = new Map() as typeof fideData;

  const index = buildPlayerIndex(players);
  const aliasMap = buildAliasMap(players);

  // ── PASS 2: Process games one PGN file at a time (with rawPgn) ──
  console.log("\nPass 2: Build player games + game details (one file at a time)...");

  console.log("  Building player lookup maps...");
  const fideIdToSlug = new Map<string, string>();
  const nameToSlug = new Map<string, string>();
  for (const p of players) {
    if (p.fideId) fideIdToSlug.set(p.fideId, p.slug);
    nameToSlug.set(normalizePlayerName(p.name), p.slug);
  }
  console.log(`  ${fideIdToSlug.size} FIDE ID mappings, ${nameToSlug.size} name mappings`);

  // Stream player games to JSONL temp files on disk (avoid holding all PGN strings in memory)
  const GAMES_TEMP_DIR = join(tmpdir(), `fide-games-temp-${Date.now()}`);
  mkdirSync(GAMES_TEMP_DIR, { recursive: true });
  const slugsWithGames = new Set<string>();

  // Open game-details JSONL file for incremental writes (one line per game detail)
  if (existsSync(GAME_DETAILS_JSONL)) unlinkSync(GAME_DETAILS_JSONL);
  const gameDetailsFd = openSync(GAME_DETAILS_JSONL, "w");

  // Open temp JSONL files for index entries and game aliases (streamed to disk to avoid OOM)
  const INDEX_ENTRIES_JSONL = join(GAMES_TEMP_DIR, "index-entries.jsonl");
  const GAME_ALIASES_JSONL_TEMP = join(GAMES_TEMP_DIR, "game-aliases.jsonl");
  const indexEntriesFd = openSync(INDEX_ENTRIES_JSONL, "w");
  const gameAliasesFd = openSync(GAME_ALIASES_JSONL_TEMP, "w");

  console.log("  Initializing game processing state...");
  mkdirSync(GAME_DETAILS_DIR, { recursive: true });
  const gameState = createGameProcessingState(players, { minElo: opts.minElo, indexEntriesFd, gameAliasesFd, gameDetailsDir: GAME_DETAILS_DIR });
  console.log(`  Ready to process ${pgnFiles.length} PGN files\n`);

  for (let fi = 0; fi < pgnFiles.length; fi++) {
    const file = pgnFiles[fi];
    const pct = Math.round(((fi + 1) / pgnFiles.length) * 100);
    process.stdout.write(`  [${fi + 1}/${pgnFiles.length} ${pct}%] ${file.name}: reading...`);
    const pgn = readFileSync(file.path, "utf-8");
    const games = parseHeaders(pgn); // WITH rawPgn
    process.stdout.write(`\r  [${fi + 1}/${pgnFiles.length} ${pct}%] ${file.name}: processing ${games.length} games...\n`);

    // Batch JSONL appends for this file's games (one PGN file at a time in memory)
    const batchAppends = new Map<string, string>();

    for (const game of games) {
      const whiteSlug =
        (game.whiteFideId && fideIdToSlug.get(game.whiteFideId)) ||
        nameToSlug.get(normalizePlayerName(game.white));
      const blackSlug =
        (game.blackFideId && fideIdToSlug.get(game.blackFideId)) ||
        nameToSlug.get(normalizePlayerName(game.black));

      const jsonLine = JSON.stringify(game.rawPgn) + "\n";

      if (whiteSlug) {
        batchAppends.set(whiteSlug, (batchAppends.get(whiteSlug) ?? "") + jsonLine);
        slugsWithGames.add(whiteSlug);
      }
      if (blackSlug) {
        batchAppends.set(blackSlug, (batchAppends.get(blackSlug) ?? "") + jsonLine);
        slugsWithGames.add(blackSlug);
      }
    }

    // Flush batch to JSONL files on disk
    for (const [slug, lines] of batchAppends) {
      appendFileSync(join(GAMES_TEMP_DIR, `${slug}.jsonl`), lines);
    }

    // Write game details to JSONL immediately (no accumulation)
    processGameDetailsChunk(games, gameState, gameDetailsFd);
    // games + batchAppends freed at next iteration
  }

  // Close all JSONL file descriptors
  closeSync(gameDetailsFd);
  closeSync(indexEntriesFd);
  closeSync(gameAliasesFd);

  // Convert JSONL temp files to final JSON array files
  const totalSlugs = slugsWithGames.size;
  console.log(`\nWriting per-player game files (${totalSlugs} players)...`);
  if (existsSync(GAMES_DIR)) rmSync(GAMES_DIR, { recursive: true });
  mkdirSync(GAMES_DIR, { recursive: true });
  let gameFilesWritten = 0;
  for (const slug of slugsWithGames) {
    const jsonlPath = join(GAMES_TEMP_DIR, `${slug}.jsonl`);
    if (!existsSync(jsonlPath)) continue;
    // Each JSONL line is already a valid JSON value — avoid parse+re-stringify
    const raw = readFileSync(jsonlPath, "utf-8").trimEnd();
    writeFileSync(join(GAMES_DIR, `${slug}.json`), `[${raw.replaceAll("\n", ",")}]`);
    gameFilesWritten++;
    if (gameFilesWritten % 5000 === 0 || gameFilesWritten === totalSlugs) {
      const pct = Math.round((gameFilesWritten / totalSlugs) * 100);
      console.log(`  [${gameFilesWritten}/${totalSlugs} ${pct}%] game files written`);
    }
  }

  // Finalize recent/notable games (game index + aliases are already on disk as JSONL)
  console.log("Finalizing recent/notable games...");
  const totalGamesIndexed = gameState.totalGamesIndexed;
  const gameDetailFilesWritten = gameState.filesWritten;
  const { playerRecentGames, playerNotableGames } = finalizeGameProcessing(gameState);
  console.log(`  ${totalGamesIndexed} games indexed`);

  // Free gameState
  gameState.recentGamesMap.clear();
  gameState.notableGamesMap.clear();
  gameState.seenKeys.clear();
  gameState.slugCounts.clear();
  gameState.legacySlugCounts.clear();
  gameState.playerByFideId.clear();

  console.log("Attaching recent/notable games to players...");
  for (const p of players) {
    p.recentGames = playerRecentGames.get(p.slug) ?? [];
    const notable = playerNotableGames.get(p.slug);
    if (notable && notable.length > 0) p.notableGames = notable;
  }
  // Free maps now that data is on players
  playerRecentGames.clear();
  playerNotableGames.clear();

  // Save index, players, aliases, game index, game aliases
  // Stream-write large files to avoid OOM from JSON.stringify on huge arrays
  console.log("\nWriting output files...");

  console.log("  index.json...");
  writeFileSync(join(PROCESSED_DIR, "index.json"), JSON.stringify(index));

  console.log(`  players.json (${players.length} players)...`);
  streamWriteJsonArray(join(PROCESSED_DIR, "players.json"), players);

  console.log("  aliases.json...");
  writeFileSync(join(PROCESSED_DIR, "aliases.json"), JSON.stringify(aliasMap));

  console.log(`  game-index.json (${totalGamesIndexed} games)...`);
  await streamWriteGameIndexFromJsonl(join(PROCESSED_DIR, "game-index.json"), INDEX_ENTRIES_JSONL, totalGamesIndexed);

  console.log(`  game-aliases.json...`);
  const totalGameAliases = await streamWriteGameAliasesFromJsonl(join(PROCESSED_DIR, "game-aliases.json"), GAME_ALIASES_JSONL_TEMP);

  // Clean up temp directory (after all JSONL reads are done)
  console.log("\nCleaning up temp files...");
  rmSync(GAMES_TEMP_DIR, { recursive: true, force: true });

  console.log(`\nProcessed data saved to ${PROCESSED_DIR}/`);
  console.log(`  index.json:          ${index.totalPlayers} players`);
  console.log(`  players.json:        ${players.length} player profiles`);
  console.log(`  games/:              ${gameFilesWritten} game files`);
  console.log(`  game-details.jsonl:  ${gameDetailFilesWritten} game pages`);
  console.log(`  game-index.json:     ${totalGamesIndexed} games indexed`);
  console.log(`  aliases.json:        ${Object.keys(aliasMap).length} aliases`);
  console.log(`  game-aliases:        ${totalGameAliases} game aliases\n`);

  return { players, index, aliasMap, gameFilesWritten, gameDetailFilesWritten };
}

// ─── smoke ────────────────────────────────────────────────────────────────────

program
  .command("smoke")
  .description("End-to-end smoke test with 1 TWIC issue")
  .option("--issue <n>", "TWIC issue number to test with", "1633")
  .option("--skip-upload", "Skip Blob upload (local-only test)")
  .action(async (opts) => {
    const issue = parseInt(opts.issue);
    console.log(`\nSmoke test — TWIC issue ${issue}\n`);

    // 1. Download
    console.log("Step 1: Download");
    const pgn = await downloadTWIC(issue);
    if (!pgn) {
      console.error("Failed to download. Aborting.");
      process.exit(1);
    }
    const sizeMB = (Buffer.byteLength(pgn, "utf-8") / 1024 / 1024).toFixed(1);
    console.log(`  Downloaded: ${sizeMB} MB PGN\n`);

    // 2. Parse
    console.log("Step 2: Parse headers");
    const start = Date.now();
    const games = parseHeaders(pgn);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  Parsed: ${games.length} game headers in ${elapsed}s\n`);

    // 3. Aggregate
    console.log("Step 3: Aggregate players");
    const players = aggregatePlayers(games, 1); // min 1 game for smoke test
    console.log(`  Players: ${players.length} unique rated players`);

    // 3b. Download FIDE rating list if needed, then enrich
    await downloadFideRatings();
    console.log("\n  Enriching with FIDE rating list...");
    const fideData = loadFideData(RATINGS_DIR);
    const enrichedCount = enrichPlayers(players, fideData);
    console.log(`  Enriched ${enrichedCount}/${players.length} players with full names + ratings`);

    // Re-sort by rating after enrichment
    players.sort((a, b) => b.fideRating - a.fideRating);

    // Show some sample data
    const topPlayers = players.slice(0, 5);
    console.log("\n  Top players by rating:");
    for (const p of topPlayers) {
      console.log(
        `    ${p.name} (${p.title ?? "—"} ${p.fideRating}) — ${p.gameCount} games, slug: ${p.slug}`
      );
    }

    // 4. Build index + aliases (after enrichment so slugs are final)
    const index = buildPlayerIndex(players);
    const aliasMap = buildAliasMap(players);

    // 5. Write per-player game files to disk
    ensureDirs();
    const gameFilesWritten = writePlayerGames(games, players, GAMES_DIR);

    // 5b. Build game detail pages (min Elo 0 for smoke — include all games)
    console.log("\n  Building game detail pages...");
    const gameDetails = buildGameDetails(games, players, { minElo: 0 });
    const gameIndex = buildGameIndex(gameDetails);
    // Write game details as JSONL (one JSON object per line) + per-game JSON files
    const gameDetailsFd = openSync(GAME_DETAILS_JSONL, "w");
    mkdirSync(GAME_DETAILS_DIR, { recursive: true });
    for (const detail of gameDetails) {
      writeSync(gameDetailsFd, JSON.stringify(detail) + "\n");
      const filePath = join(GAME_DETAILS_DIR, `${detail.slug}.json`);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(detail));
    }
    closeSync(gameDetailsFd);
    const gameDetailFilesWritten = gameDetails.length;
    console.log(`  ${gameDetailFilesWritten} game pages generated`);

    // 5c. Build game alias map (legacy slugs → new slugs for 301 redirects)
    const gameAliasMap = buildGameAliasMap(games, players, { minElo: 0 });

    // 5d. Cross-link players with their recent games + notable games
    const playerRecentGames = buildPlayerRecentGames(gameDetails);
    const playerNotableGames = buildPlayerNotableGames(gameDetails, playerRecentGames);
    for (const p of players) {
      p.recentGames = playerRecentGames.get(p.slug) ?? [];
      const notable = playerNotableGames.get(p.slug);
      if (notable && notable.length > 0) p.notableGames = notable;
    }

    // Save index + players + aliases + game index + game aliases
    writeFileSync(
      join(PROCESSED_DIR, "smoke-index.json"),
      JSON.stringify(index, null, 2)
    );
    writeFileSync(
      join(PROCESSED_DIR, "index.json"),
      JSON.stringify(index)
    );
    writeFileSync(
      join(PROCESSED_DIR, "smoke-players.json"),
      JSON.stringify(players, null, 2)
    );
    writeFileSync(
      join(PROCESSED_DIR, "players.json"),
      JSON.stringify(players)
    );
    writeFileSync(
      join(PROCESSED_DIR, "aliases.json"),
      JSON.stringify(aliasMap, null, 2)
    );
    writeFileSync(
      join(PROCESSED_DIR, "game-index.json"),
      JSON.stringify(gameIndex)
    );
    writeFileSync(
      join(PROCESSED_DIR, "game-aliases.json"),
      JSON.stringify(gameAliasMap, null, 2)
    );

    console.log(`\n  Saved data to ${PROCESSED_DIR}/ (${players.length} players, ${gameFilesWritten} game files, ${gameDetailFilesWritten} game pages, ${Object.keys(aliasMap).length} aliases, ${Object.keys(gameAliasMap).length} game aliases)`);

    // 6. Upload (optional)
    if (!opts.skipUpload) {
      console.log("\nStep 4: Upload to Vercel Blob (fide-smoke/ prefix)");

      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error(
          "  BLOB_READ_WRITE_TOKEN not set. Set it or use --skip-upload."
        );
        console.error(
          "  Get a token from: Vercel Dashboard → Storage → Blob → Tokens"
        );
        process.exit(1);
      }

      const result = await uploadAllFromDisk(players, index, aliasMap, GAMES_DIR, {
        prefix: "fide-smoke",
        gameDetailsJsonl: GAME_DETAILS_JSONL,
        gameDetailCount: gameDetailFilesWritten,
        gameIndex,
        onProgress: (uploaded, total) => {
          if (uploaded % 100 === 0 || uploaded === total) {
            console.log(`  Uploaded ${uploaded}/${total}`);
          }
        },
      });

      console.log(`\n  Index URL: ${result.indexUrl}`);
      console.log(`  Players uploaded: ${result.playersUploaded}`);
      console.log(`  Game files uploaded: ${result.gamesUploaded}`);
      console.log(`  Game pages uploaded: ${result.gameDetailsUploaded}`);
    } else {
      console.log("\nStep 4: Upload skipped (--skip-upload)");
    }

    // Summary
    console.log("\n─── Smoke Test Summary ───");
    console.log(`  TWIC issue:      ${issue}`);
    console.log(`  Games parsed:    ${games.length}`);
    console.log(`  Unique players:  ${players.length}`);
    console.log(`  Parse time:      ${elapsed}s`);
    if (!opts.skipUpload && process.env.BLOB_READ_WRITE_TOKEN) {
      console.log(`  Blob prefix:     fide-smoke/`);
    }
    console.log("");
  });

// ─── download ─────────────────────────────────────────────────────────────────

program
  .command("download")
  .description("Download TWIC zip files and extract PGNs")
  .requiredOption("--from <n>", "First TWIC issue number")
  .requiredOption("--to <n>", "Last TWIC issue number")
  .option("--delay <ms>", "Delay between downloads in ms", "500")
  .action(async (opts) => {
    const from = parseInt(opts.from);
    const to = parseInt(opts.to);
    const delay = parseInt(opts.delay);

    console.log(`\nDownloading TWIC issues ${from}–${to} (${to - from + 1} issues)\n`);

    const results = await downloadRange(from, to, { delayMs: delay });

    console.log(`\nDownloaded ${results.size} issues successfully.`);

    // Save metadata
    ensureDirs();
    const meta = {
      from,
      to,
      downloaded: results.size,
      issues: Array.from(results.keys()),
      timestamp: new Date().toISOString(),
    };
    writeFileSync(join(DATA_DIR, "download-meta.json"), JSON.stringify(meta, null, 2));
    console.log(`Metadata saved to ${DATA_DIR}/download-meta.json\n`);
  });

// ─── download-ratings ─────────────────────────────────────────────────────────

program
  .command("download-ratings")
  .description("Download the official FIDE rating list (Standard/Rapid/Blitz)")
  .option("--force", "Re-download even if the file already exists")
  .action(async (opts) => {
    console.log("\nDownloading FIDE rating list...\n");
    const ok = await downloadFideRatings({ force: opts.force });
    if (!ok) {
      console.error("Failed to download FIDE rating list.");
      process.exit(1);
    }
    console.log("\nFIDE rating list ready.\n");
  });

// ─── process ──────────────────────────────────────────────────────────────────

program
  .command("process")
  .description("Process downloaded PGNs into player data")
  .option("--min-games <n>", "Minimum games per player", "3")
  .option("--min-elo <n>", "Minimum Elo for game page indexing", "100")
  .action(async (opts) => {
    const minGames = parseInt(opts.minGames);
    const minElo = parseInt(opts.minElo);
    ensureDirs();

    // Find all downloaded PGN files
    const pgnFileNames = readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".pgn"))
      .sort();

    if (pgnFileNames.length === 0) {
      console.error("No PGN files found in data/. Run 'download' first.");
      process.exit(1);
    }

    console.log(`\nProcessing ${pgnFileNames.length} PGN files (min ${minGames} games/player)\n`);

    const pgnFiles = pgnFileNames.map((f) => ({ name: f, path: join(DATA_DIR, f) }));
    await processTwoPass(pgnFiles, { minGames, minElo });
  });

// ─── upload ───────────────────────────────────────────────────────────────────

program
  .command("upload")
  .description("Upload processed data to Vercel Blob")
  .option("--prefix <p>", "Blob path prefix", "fide")
  .action(async (opts) => {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error("BLOB_READ_WRITE_TOKEN environment variable is required.");
      console.error("Get a token from: Vercel Dashboard → Storage → Blob → Tokens");
      process.exit(1);
    }

    ensureDirs();

    const indexPath = join(PROCESSED_DIR, "index.json");
    const playersPath = join(PROCESSED_DIR, "players.json");

    if (!existsSync(indexPath) || !existsSync(playersPath)) {
      console.error("Processed data not found. Run 'process' first.");
      process.exit(1);
    }

    if (!existsSync(GAMES_DIR)) {
      console.error("Game files not found at games/. Run 'process' first.");
      process.exit(1);
    }

    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    const players: FIDEPlayer[] = JSON.parse(readFileSync(playersPath, "utf-8"));

    // Load aliases
    const aliasesPath = join(PROCESSED_DIR, "aliases.json");
    const aliases: Record<string, string> = existsSync(aliasesPath)
      ? JSON.parse(readFileSync(aliasesPath, "utf-8"))
      : buildAliasMap(players);

    const gameFileCount = readdirSync(GAMES_DIR).filter(f => f.endsWith(".json")).length;

    // Game index: stream from disk (1GB+) instead of reading into memory
    const gameIndexPath = join(PROCESSED_DIR, "game-index.json");
    const hasGameIndex = existsSync(gameIndexPath);

    // Count game details from JSONL file by streaming (avoid reading entire file)
    let gameDetailCount = 0;
    if (existsSync(GAME_DETAILS_JSONL)) {
      const rl = createInterface({
        input: createReadStream(GAME_DETAILS_JSONL, { encoding: "utf-8" }),
        crlfDelay: Infinity,
      });
      for await (const _ of rl) gameDetailCount++;
    }

    // Game aliases: stream from disk (355MB+) instead of reading into memory
    const gameAliasesPath = join(PROCESSED_DIR, "game-aliases.json");
    const hasGameAliases = existsSync(gameAliasesPath);

    console.log(`\nUploading to Vercel Blob (prefix: ${opts.prefix}/)`);
    console.log(`  ${index.totalPlayers} players, ${gameFileCount} game files, ${gameDetailCount} game pages, ${Object.keys(aliases).length} aliases\n`);

    const start = Date.now();
    const result = await uploadAllFromDisk(players, index, aliases, GAMES_DIR, {
      prefix: opts.prefix,
      gameDetailsJsonl: existsSync(GAME_DETAILS_JSONL) ? GAME_DETAILS_JSONL : undefined,
      gameDetailCount,
      gameIndexPath: hasGameIndex ? gameIndexPath : undefined,
      gameAliasesPath: hasGameAliases ? gameAliasesPath : undefined,
      onProgress: (uploaded, total) => {
        if (uploaded % 200 === 0 || uploaded === total) {
          const pct = Math.round((uploaded / total) * 100);
          console.log(`  Progress: ${uploaded}/${total} (${pct}%)`);
        }
      },
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nUpload complete in ${elapsed}s`);
    console.log(`  Index URL:        ${result.indexUrl}`);
    console.log(`  Players uploaded:  ${result.playersUploaded}`);
    console.log(`  Game files:        ${result.gamesUploaded}`);
    console.log(`  Game pages:        ${result.gameDetailsUploaded}\n`);
  });

// ─── upload-pg ───────────────────────────────────────────────────────────────

program
  .command("upload-pg")
  .description("Upload processed data to Vercel Postgres (replaces Blob upload)")
  .action(async () => {
    if (!process.env.DATABASE_URL) {
      console.error("DATABASE_URL environment variable is required.");
      console.error("Set it in .env or use: docker compose up -d");
      process.exit(1);
    }

    ensureDirs();

    const playersPath = join(PROCESSED_DIR, "players.json");
    if (!existsSync(playersPath)) {
      console.error("Processed data not found. Run 'process' first.");
      process.exit(1);
    }

    console.log("\n═══ Upload to Postgres ═══\n");
    const start = Date.now();

    // Ensure schema exists
    console.log("Ensuring schema...");
    await ensureSchema();

    // Record pipeline run
    const runId = await recordPipelineRun("upload-pg", new Date().toISOString());

    try {
      // Load players
      console.log("Loading players...");
      const players: FIDEPlayer[] = JSON.parse(readFileSync(playersPath, "utf-8"));
      console.log(`  ${players.length} players loaded\n`);

      // Upsert players
      console.log("Upserting players...");
      const playersUpserted = await upsertPlayers(players, (count, total) => {
        if (count % 1000 === 0 || count === total) {
          const pct = Math.round((count / total) * 100);
          console.log(`  Players: ${count}/${total} (${pct}%)`);
        }
      });
      console.log(`  ${playersUpserted} players upserted\n`);

      // Upsert player aliases
      console.log("Upserting player aliases...");
      const aliasCount = await upsertPlayerAliases(players, (count) => {
        if (count % 5000 === 0) {
          console.log(`  Aliases: ${count}`);
        }
      });
      console.log(`  ${aliasCount} aliases upserted\n`);

      // Upsert games from JSONL
      if (existsSync(GAME_DETAILS_JSONL)) {
        console.log("Upserting games from JSONL...");
        const gamesUpserted = await upsertGamesFromJsonl(GAME_DETAILS_JSONL, (count) => {
          if (count % 10000 === 0) {
            console.log(`  Games: ${count}`);
          }
        });
        console.log(`  ${gamesUpserted} games upserted\n`);
      }

      // Upsert game aliases
      const gameAliasesPath = join(PROCESSED_DIR, "game-aliases.json");
      if (existsSync(gameAliasesPath)) {
        console.log("Upserting game aliases...");
        const gameAliasCount = await upsertGameAliases(gameAliasesPath, (count) => {
          if (count % 10000 === 0) {
            console.log(`  Game aliases: ${count}`);
          }
        });
        console.log(`  ${gameAliasCount} game aliases upserted\n`);
      }

      await completePipelineRun(runId);

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`\n═══ Postgres Upload Complete (${elapsed}s) ═══\n`);
    } catch (e) {
      await failPipelineRun(runId, String(e));
      throw e;
    }
  });

// ─── full ─────────────────────────────────────────────────────────────────────

program
  .command("full")
  .description("Download, process, and upload in one go")
  .requiredOption("--from <n>", "First TWIC issue number")
  .requiredOption("--to <n>", "Last TWIC issue number")
  .option("--min-games <n>", "Minimum games per player", "3")
  .option("--min-elo <n>", "Minimum Elo for game page indexing", "100")
  .option("--prefix <p>", "Blob path prefix", "fide")
  .option("--delay <ms>", "Delay between downloads in ms", "500")
  .action(async (opts) => {
    const from = parseInt(opts.from);
    const to = parseInt(opts.to);
    const minGames = parseInt(opts.minGames);
    const minElo = parseInt(opts.minElo);

    console.log(`\n═══ Full Pipeline: TWIC ${from}–${to} ═══\n`);

    // Step 1: Download (PGNs are saved to disk by downloadTWIC)
    console.log("Step 1/3: Download\n");
    await downloadRange(from, to, { delayMs: parseInt(opts.delay) });
    // Don't hold returned Map — PGNs are already cached on disk

    // Step 2: Process using two-pass architecture
    console.log("\nStep 2/3: Process\n");
    ensureDirs();

    const pgnFileNames = readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".pgn"))
      .sort();

    const pgnFiles = pgnFileNames.map((f) => ({ name: f, path: join(DATA_DIR, f) }));
    const { players, index, aliasMap, gameDetailFilesWritten } =
      await processTwoPass(pgnFiles, { minGames, minElo });

    // Step 3: Upload
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.log("\n  BLOB_READ_WRITE_TOKEN not set. Data saved locally.");
      console.log(`  Saved to ${PROCESSED_DIR}/\n`);
      return;
    }

    console.log(`\nStep 3/3: Upload to Vercel Blob (prefix: ${opts.prefix}/)\n`);

    // Stream large files from disk instead of using in-memory objects
    // (processTwoPass clears gameIndex.games after writing to disk, so
    //  the in-memory object would upload an empty game index)
    const fullGameIndexPath = join(PROCESSED_DIR, "game-index.json");
    const fullGameAliasesPath = join(PROCESSED_DIR, "game-aliases.json");

    const result = await uploadAllFromDisk(players, index, aliasMap, GAMES_DIR, {
      prefix: opts.prefix,
      gameDetailsJsonl: GAME_DETAILS_JSONL,
      gameDetailCount: gameDetailFilesWritten,
      gameIndexPath: existsSync(fullGameIndexPath) ? fullGameIndexPath : undefined,
      gameAliasesPath: existsSync(fullGameAliasesPath) ? fullGameAliasesPath : undefined,
      onProgress: (uploaded, total) => {
        if (uploaded % 500 === 0 || uploaded === total) {
          const pct = Math.round((uploaded / total) * 100);
          console.log(`  Progress: ${uploaded}/${total} (${pct}%)`);
        }
      },
    });

    console.log(`\n═══ Pipeline Complete ═══`);
    console.log(`  Players:          ${players.length}`);
    console.log(`  Game pages:       ${gameDetailFilesWritten}`);
    console.log(`  Index URL:        ${result.indexUrl}`);
    console.log(`  Players uploaded:  ${result.playersUploaded}`);
    console.log(`  Game files:        ${result.gamesUploaded}`);
    console.log(`  Game pages:        ${result.gameDetailsUploaded}\n`);
  });

program.parse();

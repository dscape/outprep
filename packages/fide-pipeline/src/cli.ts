#!/usr/bin/env node

/**
 * FIDE pipeline CLI — download TWIC data, process players, upload to Vercel Blob.
 */

import { Command } from "commander";
import { downloadTWIC, downloadRange } from "./download";
import { parseHeaders } from "./fast-parser";
import {
  aggregatePlayers,
  buildPlayerIndex,
  normalizePlayerName,
} from "./aggregate";
import { uploadAllFromDisk } from "./upload";
import { loadFideData, enrichPlayers } from "./fide-enrichment";
import { buildGameDetails, buildGameIndex, buildPlayerRecentGames, writeGameFiles } from "./game-indexer";
import type { TWICGameHeader, FIDEPlayer, GameIndex } from "./types";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

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
const GAME_DETAILS_DIR = join(PROCESSED_DIR, "game-details");
const RATINGS_DIR = join(DATA_DIR, "ratings");

function ensureDirs(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(PROCESSED_DIR)) mkdirSync(PROCESSED_DIR, { recursive: true });
  if (!existsSync(GAMES_DIR)) mkdirSync(GAMES_DIR, { recursive: true });
  if (!existsSync(GAME_DETAILS_DIR)) mkdirSync(GAME_DETAILS_DIR, { recursive: true });
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

    // 3b. Enrich with FIDE names + ratings
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
    const gameDetailFilesWritten = writeGameFiles(gameDetails, GAME_DETAILS_DIR);
    console.log(`  ${gameDetailFilesWritten} game pages generated`);

    // 5c. Cross-link players with their recent games (inline display data)
    const playerRecentGames = buildPlayerRecentGames(gameDetails);
    for (const p of players) {
      p.recentGames = playerRecentGames.get(p.slug) ?? [];
    }

    // Save index + players + aliases + game index
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

    console.log(`\n  Saved data to ${PROCESSED_DIR}/ (${players.length} players, ${gameFilesWritten} game files, ${gameDetailFilesWritten} game pages, ${Object.keys(aliasMap).length} aliases)`);

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
        gameDetailsDir: GAME_DETAILS_DIR,
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

// ─── process ──────────────────────────────────────────────────────────────────

program
  .command("process")
  .description("Process downloaded PGNs into player data")
  .option("--min-games <n>", "Minimum games per player", "3")
  .option("--min-elo <n>", "Minimum Elo for game page indexing", "2000")
  .action(async (opts) => {
    const minGames = parseInt(opts.minGames);
    const minElo = parseInt(opts.minElo);
    ensureDirs();

    // Find all downloaded PGN files
    const pgnFiles = readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".pgn"))
      .sort();

    if (pgnFiles.length === 0) {
      console.error("No PGN files found in data/. Run 'download' first.");
      process.exit(1);
    }

    console.log(`\nProcessing ${pgnFiles.length} PGN files (min ${minGames} games/player)\n`);

    // Parse all PGN files
    let allGames: TWICGameHeader[] = [];
    for (const file of pgnFiles) {
      const pgn = readFileSync(join(DATA_DIR, file), "utf-8");
      const start = Date.now();
      const games = parseHeaders(pgn);
      const ms = Date.now() - start;
      console.log(`  ${file}: ${games.length} games (${ms}ms)`);
      allGames = allGames.concat(games);
    }

    console.log(`\nTotal games: ${allGames.length}`);

    // Aggregate (lightweight — no raw PGNs stored in accumulators)
    console.log("\nAggregating players...");
    const players = aggregatePlayers(allGames, minGames);
    console.log(`  ${players.length} players with ${minGames}+ games`);

    // Enrich with FIDE names + ratings
    console.log("\nEnriching with FIDE rating list...");
    const fideData = loadFideData(RATINGS_DIR);
    const enrichedCount = enrichPlayers(players, fideData);
    console.log(`  Enriched ${enrichedCount}/${players.length} players`);
    players.sort((a, b) => b.fideRating - a.fideRating);

    // Build index + aliases (after enrichment)
    const index = buildPlayerIndex(players);
    const aliasMap = buildAliasMap(players);

    // Write per-player game files to disk (one file per player)
    console.log("\nWriting per-player game files...");
    const gameFilesWritten = writePlayerGames(allGames, players, GAMES_DIR);
    console.log(`  ${gameFilesWritten} game files written`);

    // Build game detail pages
    console.log(`\nBuilding game detail pages (min Elo ${minElo})...`);
    const gameDetails = buildGameDetails(allGames, players, { minElo });
    const gameIndex = buildGameIndex(gameDetails);
    const gameDetailFilesWritten = writeGameFiles(gameDetails, GAME_DETAILS_DIR);
    console.log(`  ${gameDetailFilesWritten} game pages generated`);

    // Cross-link players with their recent games (inline display data)
    const playerRecentGames = buildPlayerRecentGames(gameDetails);
    for (const p of players) {
      p.recentGames = playerRecentGames.get(p.slug) ?? [];
    }

    // Free allGames memory before writing remaining files
    allGames = [];

    // Save index, players, aliases, game index
    writeFileSync(join(PROCESSED_DIR, "index.json"), JSON.stringify(index));
    writeFileSync(join(PROCESSED_DIR, "players.json"), JSON.stringify(players));
    writeFileSync(join(PROCESSED_DIR, "aliases.json"), JSON.stringify(aliasMap));
    writeFileSync(join(PROCESSED_DIR, "game-index.json"), JSON.stringify(gameIndex));

    console.log(`\nProcessed data saved to ${PROCESSED_DIR}/`);
    console.log(`  index.json:      ${index.totalPlayers} players`);
    console.log(`  players.json:    ${players.length} player profiles`);
    console.log(`  games/:          ${gameFilesWritten} game files`);
    console.log(`  game-details/:   ${gameDetailFilesWritten} game pages`);
    console.log(`  game-index.json: ${gameIndex.totalGames} games indexed`);
    console.log(`  aliases.json:    ${Object.keys(aliasMap).length} aliases\n`);
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

    // Load game index if available
    const gameIndexPath = join(PROCESSED_DIR, "game-index.json");
    const gameIndex: GameIndex | undefined = existsSync(gameIndexPath)
      ? JSON.parse(readFileSync(gameIndexPath, "utf-8"))
      : undefined;
    const gameDetailCount = existsSync(GAME_DETAILS_DIR)
      ? readdirSync(GAME_DETAILS_DIR).filter(f => f.endsWith(".json")).length
      : 0;

    console.log(`\nUploading to Vercel Blob (prefix: ${opts.prefix}/)`);
    console.log(`  ${index.totalPlayers} players, ${gameFileCount} game files, ${gameDetailCount} game pages, ${Object.keys(aliases).length} aliases\n`);

    const start = Date.now();
    const result = await uploadAllFromDisk(players, index, aliases, GAMES_DIR, {
      prefix: opts.prefix,
      gameDetailsDir: existsSync(GAME_DETAILS_DIR) ? GAME_DETAILS_DIR : undefined,
      gameIndex,
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

// ─── full ─────────────────────────────────────────────────────────────────────

program
  .command("full")
  .description("Download, process, and upload in one go")
  .requiredOption("--from <n>", "First TWIC issue number")
  .requiredOption("--to <n>", "Last TWIC issue number")
  .option("--min-games <n>", "Minimum games per player", "3")
  .option("--min-elo <n>", "Minimum Elo for game page indexing", "2000")
  .option("--prefix <p>", "Blob path prefix", "fide")
  .option("--delay <ms>", "Delay between downloads in ms", "500")
  .action(async (opts) => {
    const from = parseInt(opts.from);
    const to = parseInt(opts.to);
    const minGames = parseInt(opts.minGames);
    const minElo = parseInt(opts.minElo);

    console.log(`\n═══ Full Pipeline: TWIC ${from}–${to} ═══\n`);

    // Step 1: Download
    console.log("Step 1/3: Download\n");
    const pgns = await downloadRange(from, to, { delayMs: parseInt(opts.delay) });
    console.log(`\n  Downloaded ${pgns.size} issues\n`);

    // Step 2: Parse + aggregate
    console.log("Step 2/3: Parse & Aggregate\n");
    let allGames: TWICGameHeader[] = [];
    for (const [issue, pgn] of pgns) {
      const games = parseHeaders(pgn);
      console.log(`  TWIC ${issue}: ${games.length} games`);
      allGames = allGames.concat(games);
    }
    console.log(`\n  Total games: ${allGames.length}`);

    const players = aggregatePlayers(allGames, minGames);
    console.log(`  Players with ${minGames}+ games: ${players.length}`);

    // Enrich with FIDE names + ratings
    console.log("\n  Enriching with FIDE rating list...");
    const fideData = loadFideData(RATINGS_DIR);
    const enrichedCount = enrichPlayers(players, fideData);
    console.log(`  Enriched ${enrichedCount}/${players.length} players`);
    players.sort((a, b) => b.fideRating - a.fideRating);

    const index = buildPlayerIndex(players);
    const aliasMap = buildAliasMap(players);

    // Write per-player game files to disk
    ensureDirs();
    console.log("\n  Writing per-player game files...");
    const gameFilesWritten = writePlayerGames(allGames, players, GAMES_DIR);
    console.log(`  ${gameFilesWritten} game files written`);

    // Build game detail pages
    console.log(`\n  Building game detail pages (min Elo ${minElo})...`);
    const gameDetails = buildGameDetails(allGames, players, { minElo });
    const gameIndex = buildGameIndex(gameDetails);
    const gameDetailFilesWritten = writeGameFiles(gameDetails, GAME_DETAILS_DIR);
    console.log(`  ${gameDetailFilesWritten} game pages generated`);

    // Cross-link players with their recent games (inline display data)
    const playerRecentGames = buildPlayerRecentGames(gameDetails);
    for (const p of players) {
      p.recentGames = playerRecentGames.get(p.slug) ?? [];
    }

    // Free allGames memory before upload/save
    allGames = [];

    // Save index, players, aliases, game index to disk
    writeFileSync(join(PROCESSED_DIR, "index.json"), JSON.stringify(index));
    writeFileSync(join(PROCESSED_DIR, "players.json"), JSON.stringify(players));
    writeFileSync(join(PROCESSED_DIR, "aliases.json"), JSON.stringify(aliasMap));
    writeFileSync(join(PROCESSED_DIR, "game-index.json"), JSON.stringify(gameIndex));

    // Step 3: Upload
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.log("\n  BLOB_READ_WRITE_TOKEN not set. Data saved locally.");
      console.log(`  Saved to ${PROCESSED_DIR}/\n`);
      return;
    }

    console.log(`\nStep 3/3: Upload to Vercel Blob (prefix: ${opts.prefix}/)\n`);

    const result = await uploadAllFromDisk(players, index, aliasMap, GAMES_DIR, {
      prefix: opts.prefix,
      gameDetailsDir: GAME_DETAILS_DIR,
      gameIndex,
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

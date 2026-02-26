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
import { uploadAll } from "./upload";
import type { TWICGameHeader, FIDEPlayer } from "./types";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(import.meta.dirname, "..", "data");
const PROCESSED_DIR = join(DATA_DIR, "processed");

function ensureDirs(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(PROCESSED_DIR)) mkdirSync(PROCESSED_DIR, { recursive: true });
}

const program = new Command()
  .name("fide-pipeline")
  .description("Download TWIC data, process FIDE players, upload to Vercel Blob")
  .version("0.1.0");

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

    // Show some sample data
    const topPlayers = players.slice(0, 5);
    console.log("\n  Top players by rating:");
    for (const p of topPlayers) {
      console.log(
        `    ${p.name} (${p.title ?? "—"} ${p.fideRating}) — ${p.gameCount} games, slug: ${p.slug}`
      );
    }

    // 4. Build index
    const index = buildPlayerIndex(players);

    // 5. Build per-player game maps (uses FIDE ID matching)
    const playerGames = buildPlayerGameMap(games, players);

    // Build aliases map (alias → canonical slug)
    const aliasMap = buildAliasMap(players);

    // Save processed data locally (full data for dev mode)
    ensureDirs();
    writeFileSync(
      join(PROCESSED_DIR, "smoke-index.json"),
      JSON.stringify(index, null, 2)
    );
    writeFileSync(
      join(PROCESSED_DIR, "smoke-players.json"),
      JSON.stringify(players, null, 2)
    );
    // Save games for dev mode practice flow
    const gamesObj: Record<string, string[]> = {};
    for (const [slug, pgns] of playerGames) gamesObj[slug] = pgns;
    writeFileSync(
      join(PROCESSED_DIR, "games.json"),
      JSON.stringify(gamesObj)
    );
    // Save aliases for dev mode redirects
    writeFileSync(
      join(PROCESSED_DIR, "aliases.json"),
      JSON.stringify(aliasMap, null, 2)
    );

    console.log(`\n  Saved data to ${PROCESSED_DIR}/ (${players.length} players, ${playerGames.size} game files, ${Object.keys(aliasMap).length} aliases)`);

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

      const result = await uploadAll(players, index, playerGames, aliasMap, {
        prefix: "fide-smoke",
        onProgress: (uploaded, total) => {
          if (uploaded % 100 === 0 || uploaded === total) {
            console.log(`  Uploaded ${uploaded}/${total}`);
          }
        },
      });

      console.log(`\n  Index URL: ${result.indexUrl}`);
      console.log(`  Players uploaded: ${result.playersUploaded}`);
      console.log(`  Game files uploaded: ${result.gamesUploaded}`);
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
  .action(async (opts) => {
    const minGames = parseInt(opts.minGames);
    ensureDirs();

    // Find all downloaded PGN files
    const { readdirSync } = await import("node:fs");
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

    // Aggregate
    console.log("\nAggregating players...");
    const players = aggregatePlayers(allGames, minGames);
    console.log(`  ${players.length} players with ${minGames}+ games`);

    // Build index
    const index = buildPlayerIndex(players);

    // Build per-player game maps
    console.log("\nBuilding per-player game files...");
    const playerGames = buildPlayerGameMap(allGames, players);
    console.log(`  ${playerGames.size} game files prepared`);

    // Save to processed dir
    writeFileSync(
      join(PROCESSED_DIR, "index.json"),
      JSON.stringify(index)
    );
    writeFileSync(
      join(PROCESSED_DIR, "players.json"),
      JSON.stringify(players)
    );

    // Save games per player (chunked into files of 1000 players each for manageability)
    const gamesObj: Record<string, string[]> = {};
    for (const [slug, pgns] of playerGames) {
      gamesObj[slug] = pgns;
    }
    writeFileSync(
      join(PROCESSED_DIR, "games.json"),
      JSON.stringify(gamesObj)
    );

    // Save aliases
    const aliasMap = buildAliasMap(players);
    writeFileSync(
      join(PROCESSED_DIR, "aliases.json"),
      JSON.stringify(aliasMap)
    );

    console.log(`\nProcessed data saved to ${PROCESSED_DIR}/`);
    console.log(`  index.json:   ${index.totalPlayers} players`);
    console.log(`  players.json: ${players.length} player profiles`);
    console.log(`  games.json:   ${playerGames.size} game files`);
    console.log(`  aliases.json: ${Object.keys(aliasMap).length} aliases\n`);
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
    const gamesPath = join(PROCESSED_DIR, "games.json");

    if (!existsSync(indexPath) || !existsSync(playersPath)) {
      console.error("Processed data not found. Run 'process' first.");
      process.exit(1);
    }

    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    const players: FIDEPlayer[] = JSON.parse(readFileSync(playersPath, "utf-8"));

    let playerGames = new Map<string, string[]>();
    if (existsSync(gamesPath)) {
      const gamesObj = JSON.parse(readFileSync(gamesPath, "utf-8"));
      for (const [slug, pgns] of Object.entries(gamesObj)) {
        playerGames.set(slug, pgns as string[]);
      }
    }

    // Load aliases
    const aliasesPath = join(PROCESSED_DIR, "aliases.json");
    const aliases: Record<string, string> = existsSync(aliasesPath)
      ? JSON.parse(readFileSync(aliasesPath, "utf-8"))
      : buildAliasMap(players);

    console.log(`\nUploading to Vercel Blob (prefix: ${opts.prefix}/)`);
    console.log(`  ${index.totalPlayers} players, ${playerGames.size} game files, ${Object.keys(aliases).length} aliases\n`);

    const start = Date.now();
    const result = await uploadAll(players, index, playerGames, aliases, {
      prefix: opts.prefix,
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
    console.log(`  Game files:        ${result.gamesUploaded}\n`);
  });

// ─── full ─────────────────────────────────────────────────────────────────────

program
  .command("full")
  .description("Download, process, and upload in one go")
  .requiredOption("--from <n>", "First TWIC issue number")
  .requiredOption("--to <n>", "Last TWIC issue number")
  .option("--min-games <n>", "Minimum games per player", "3")
  .option("--prefix <p>", "Blob path prefix", "fide")
  .option("--delay <ms>", "Delay between downloads in ms", "500")
  .action(async (opts) => {
    const from = parseInt(opts.from);
    const to = parseInt(opts.to);
    const minGames = parseInt(opts.minGames);

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

    const index = buildPlayerIndex(players);
    const playerGames = buildPlayerGameMap(allGames, players);

    // Step 3: Upload
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error("\n  BLOB_READ_WRITE_TOKEN not set. Saving locally instead.");
      ensureDirs();
      writeFileSync(join(PROCESSED_DIR, "index.json"), JSON.stringify(index));
      writeFileSync(join(PROCESSED_DIR, "players.json"), JSON.stringify(players));
      const gamesObj: Record<string, string[]> = {};
      for (const [slug, p] of playerGames) gamesObj[slug] = p;
      writeFileSync(join(PROCESSED_DIR, "games.json"), JSON.stringify(gamesObj));
      const aliasMap = buildAliasMap(players);
      writeFileSync(join(PROCESSED_DIR, "aliases.json"), JSON.stringify(aliasMap));
      console.log(`  Saved to ${PROCESSED_DIR}/\n`);
      return;
    }

    const fullAliasMap = buildAliasMap(players);

    console.log(`\nStep 3/3: Upload to Vercel Blob (prefix: ${opts.prefix}/)\n`);

    const result = await uploadAll(players, index, playerGames, fullAliasMap, {
      prefix: opts.prefix,
      onProgress: (uploaded, total) => {
        if (uploaded % 500 === 0 || uploaded === total) {
          const pct = Math.round((uploaded / total) * 100);
          console.log(`  Progress: ${uploaded}/${total} (${pct}%)`);
        }
      },
    });

    console.log(`\n═══ Pipeline Complete ═══`);
    console.log(`  Games processed:  ${allGames.length}`);
    console.log(`  Players:          ${players.length}`);
    console.log(`  Index URL:        ${result.indexUrl}`);
    console.log(`  Players uploaded:  ${result.playersUploaded}`);
    console.log(`  Game files:        ${result.gamesUploaded}\n`);
  });

program.parse();

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function buildPlayerGameMap(
  allGames: TWICGameHeader[],
  players: FIDEPlayer[]
): Map<string, string[]> {
  // Build lookups: FIDE ID → slug (primary), normalized name → slug (fallback)
  const fideIdToSlug = new Map<string, string>();
  const nameToSlug = new Map<string, string>();
  for (const p of players) {
    if (p.fideId) {
      fideIdToSlug.set(p.fideId, p.slug);
    }
    nameToSlug.set(normalizePlayerName(p.name), p.slug);
  }

  // Collect games per player
  const result = new Map<string, string[]>();
  for (const p of players) {
    result.set(p.slug, []);
  }

  for (const game of allGames) {
    // Match white player: prefer FIDE ID, fall back to name
    const whiteSlug = (game.whiteFideId && fideIdToSlug.get(game.whiteFideId))
      || nameToSlug.get(normalizePlayerName(game.white));
    // Match black player: prefer FIDE ID, fall back to name
    const blackSlug = (game.blackFideId && fideIdToSlug.get(game.blackFideId))
      || nameToSlug.get(normalizePlayerName(game.black));

    if (whiteSlug) {
      result.get(whiteSlug)?.push(game.rawPgn);
    }
    if (blackSlug) {
      result.get(blackSlug)?.push(game.rawPgn);
    }
  }

  return result;
}

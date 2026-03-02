#!/usr/bin/env npx tsx
/**
 * Purge deprecated Blob files that have been migrated to Postgres.
 *
 * Deletes:
 *   fide/index.json, fide/aliases.json, fide/game-index.json, fide/game-aliases.json
 *   fide/players/*    (80K files)
 *   fide/game-details/* (3M files)
 *
 * Keeps:
 *   fide/games/*      (practice PGNs — still served from Blob)
 */

import { list, del } from "@vercel/blob";

const DEPRECATED_PREFIXES = [
  "fide/index.json",
  "fide/aliases.json",
  "fide/game-index.json",
  "fide/game-aliases.json",
  "fide/players/",
  "fide/game-details/",
];

// Also handle the smoke test prefix
const SMOKE_PREFIXES = [
  "fide-smoke/",
];

const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_SMOKE = process.argv.includes("--include-smoke");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry a fn with exponential backoff on rate limiting.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const isRateLimit =
        e instanceof Error && e.constructor.name === "BlobServiceRateLimited";
      if (!isRateLimit || attempt >= maxRetries) throw e;

      // Extract retryAfter from error or default to exponential backoff
      const retryAfter =
        (e as { retryAfter?: number }).retryAfter ?? 2 ** attempt * 5;
      console.log(`  Rate limited — waiting ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})...`);
      await sleep(retryAfter * 1000);
    }
  }
}

async function purgePrefix(prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;

  do {
    const result = await withRetry(() =>
      list({
        prefix,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      }),
    );

    if (result.blobs.length === 0) break;

    const urls = result.blobs.map((b) => b.url);

    if (DRY_RUN) {
      deleted += urls.length;
    } else {
      // Delete in smaller chunks to avoid rate limits
      const CHUNK = 200;
      for (let i = 0; i < urls.length; i += CHUNK) {
        const chunk = urls.slice(i, i + CHUNK);
        await withRetry(() => del(chunk));
        // Small delay between delete batches to stay under rate limits
        if (i + CHUNK < urls.length) await sleep(500);
      }
      deleted += urls.length;
    }

    if (deleted % 5000 === 0 || result.blobs.length < 1000) {
      console.log(`  ${prefix}: ${deleted} deleted so far...`);
    }

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  return deleted;
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is required.");
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("=== DRY RUN (no files will be deleted) ===\n");
  }

  const prefixes = [
    ...DEPRECATED_PREFIXES,
    ...(INCLUDE_SMOKE ? SMOKE_PREFIXES : []),
  ];

  let totalDeleted = 0;

  for (const prefix of prefixes) {
    console.log(`\nPurging: ${prefix}`);
    const count = await purgePrefix(prefix);
    totalDeleted += count;
    console.log(`  ${prefix}: ${count} files ${DRY_RUN ? "would be " : ""}deleted`);
  }

  console.log(`\n=== Total: ${totalDeleted} files ${DRY_RUN ? "would be " : ""}deleted ===`);
  console.log("\nKept: fide/games/* (practice PGNs)\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

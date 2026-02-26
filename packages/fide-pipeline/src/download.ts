/**
 * Download TWIC zip files and extract PGN content.
 *
 * TWIC URL pattern: https://theweekinchess.com/zips/twic{ISSUE}g.zip
 * Each zip contains a single .pgn file with thousands of OTB games.
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execSync } from "node:child_process";

const TWIC_BASE_URL = "https://theweekinchess.com/zips";
const DATA_DIR = join(import.meta.dirname, "..", "data");

/** Ensure the data directory exists. */
function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** Download a single TWIC zip and extract the PGN text. */
export async function downloadTWIC(issue: number): Promise<string | null> {
  ensureDataDir();
  const pgnPath = join(DATA_DIR, `twic${issue}g.pgn`);

  // Return cached PGN if already downloaded
  if (existsSync(pgnPath)) {
    return readFileSync(pgnPath, "utf-8");
  }

  const url = `${TWIC_BASE_URL}/twic${issue}g.zip`;
  const zipPath = join(DATA_DIR, `twic${issue}g.zip`);

  try {
    console.log(`  Downloading TWIC ${issue}...`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  Failed to download TWIC ${issue}: HTTP ${res.status}`);
      return null;
    }

    // Write zip to disk
    const body = res.body;
    if (!body) return null;
    const dest = createWriteStream(zipPath);
    await pipeline(Readable.fromWeb(body as never), dest);

    // Extract PGN using system unzip (handles all zip variants reliably)
    const pgnText = extractPgnFromZip(zipPath);
    if (!pgnText) {
      console.error(`  Failed to extract PGN from TWIC ${issue}`);
      return null;
    }

    // Cache the extracted PGN
    writeFileSync(pgnPath, pgnText, "utf-8");

    // Clean up the zip file
    try {
      unlinkSync(zipPath);
    } catch {}

    const sizeMB = (Buffer.byteLength(pgnText, "utf-8") / 1024 / 1024).toFixed(
      1
    );
    console.log(`  TWIC ${issue}: extracted ${sizeMB} MB PGN`);

    return pgnText;
  } catch (err) {
    console.error(`  Error downloading TWIC ${issue}:`, err);
    // Clean up partial files
    try {
      unlinkSync(zipPath);
    } catch {}
    return null;
  }
}

/**
 * Extract the .pgn file from a TWIC zip archive.
 * Uses `unzip -p` to pipe the PGN to stdout (works on macOS/Linux).
 */
function extractPgnFromZip(zipPath: string): string | null {
  try {
    // unzip -p extracts to stdout, unzip -l lists contents
    // First list to find the .pgn filename, then extract it
    const listing = execSync(`unzip -l "${zipPath}"`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });

    // Find the .pgn file in the listing
    const pgnMatch = listing.match(/\s(\S+\.pgn)\s*$/m);
    if (!pgnMatch) {
      console.error("  No .pgn file found in zip archive");
      return null;
    }

    const pgnFilename = pgnMatch[1];

    // Extract to stdout
    const pgnText = execSync(`unzip -p "${zipPath}" "${pgnFilename}"`, {
      encoding: "utf-8",
      maxBuffer: 100 * 1024 * 1024, // 100MB buffer for large PGN files
    });

    return pgnText;
  } catch (err) {
    console.error("  Zip extraction failed:", (err as Error).message);
    return null;
  }
}

/** Download a range of TWIC issues. Returns map of issue → PGN text. */
export async function downloadRange(
  from: number,
  to: number,
  opts?: { delayMs?: number }
): Promise<Map<number, string>> {
  const delay = opts?.delayMs ?? 500;
  const results = new Map<number, string>();

  for (let issue = from; issue <= to; issue++) {
    const pgn = await downloadTWIC(issue);
    if (pgn) {
      results.set(issue, pgn);
    }
    // Be polite to TWIC servers
    if (issue < to && delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return results;
}

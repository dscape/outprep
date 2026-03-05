/**
 * In-memory zip extraction for serverless environments.
 * Uses fflate (pure JS) instead of system `unzip` command.
 */

import { unzipSync } from "fflate";

/**
 * Download a TWIC zip and extract the PGN content in memory.
 * Returns null if the issue doesn't exist or extraction fails.
 */
export async function downloadAndExtractPgn(
  issue: number,
): Promise<string | null> {
  const url = `https://theweekinchess.com/zips/twic${issue}g.zip`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const zipBuffer = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zipBuffer);

  const pgnFileName = Object.keys(files).find((f) =>
    f.toLowerCase().endsWith(".pgn"),
  );
  if (!pgnFileName) return null;

  return new TextDecoder().decode(files[pgnFileName]);
}

/**
 * Download the FIDE rating list zip and extract the text file in memory.
 * Returns the raw text content (~295MB) or null on failure.
 */
export async function downloadAndExtractFideRatings(): Promise<string | null> {
  const url = "https://ratings.fide.com/download/players_list.zip";

  const res = await fetch(url);
  if (!res.ok) return null;

  const zipBuffer = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zipBuffer);

  const txtFileName = Object.keys(files).find((f) =>
    f.toLowerCase().endsWith(".txt"),
  );
  if (!txtFileName) return null;

  return new TextDecoder().decode(files[txtFileName]);
}

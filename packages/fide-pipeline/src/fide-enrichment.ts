/**
 * FIDE name & rating enrichment.
 *
 * Parses the official FIDE unified rating list TXT file (fixed-width format)
 * and enriches pipeline player data with full names, official ratings
 * (Standard/Rapid/Blitz), federation, and birth year.
 *
 * FIDE distributes a single file (players_list_foa.txt) inside players_list.zip
 * containing all three rating types per player.
 *
 * FIDE TXT column layout (players_list_foa.txt):
 *   Cols 0-14:    ID Number (FIDE ID)
 *   Cols 15-75:   Name ("Caruana, Fabiano")
 *   Cols 76-78:   Federation ("USA")
 *   Col  80:      Sex
 *   Cols 84-87:   Title ("GM  ")
 *   Cols 89-92:   Women's Title
 *   Cols 94-108:  Other Title
 *   Cols 109-111: FOA
 *   Cols 113-117: Standard Rating (SRtng)
 *   Cols 119-121: Standard Games (SGm)
 *   Cols 123-124: Standard K-factor (SK)
 *   Cols 126-130: Rapid Rating (RRtng)
 *   Cols 132-134: Rapid Games (RGm)
 *   Cols 136-137: Rapid K-factor (Rk)
 *   Cols 139-143: Blitz Rating (BRtng)
 *   Cols 145-147: Blitz Games (BGm)
 *   Cols 149-150: Blitz K-factor (BK)
 *   Cols 152-155: Birth year (B-day)
 *   Cols 158-161: Flag
 */

import { existsSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { generateSlug, generateAliases } from "./aggregate";
import type { FIDEPlayer } from "./types";

/** Player record from the unified FIDE rating list (all 3 rating types). */
export interface MergedFideRecord {
  name: string;
  federation: string;
  title: string | null;
  birthYear: number | null;
  standardRating: number | null;
  rapidRating: number | null;
  blitzRating: number | null;
}

/**
 * Parse the unified FIDE rating list TXT file (fixed-width format).
 * All 3 rating types (Standard, Rapid, Blitz) are in a single row per player.
 *
 * Reads the file as a raw Buffer (295 MB) rather than a UTF-16 string (~590 MB)
 * to halve memory usage. Uses Buffer.toString() for each field extraction,
 * which creates independent strings that don't keep the parent buffer alive.
 *
 * When `filterIds` is provided, only records matching those FIDE IDs are kept.
 *
 * Returns a Map of FIDE ID → MergedFideRecord.
 */
export function parseFideUnifiedList(
  txtPath: string,
  filterIds?: Set<string>
): Map<string, MergedFideRecord> {
  const buf = readFileSync(txtPath); // raw Buffer, not UTF-16 string
  const result = new Map<string, MergedFideRecord>();
  const NL = 0x0a; // '\n'

  let start = 0;
  let lineNum = 0;
  while (start < buf.length) {
    let end = buf.indexOf(NL, start);
    if (end === -1) end = buf.length;

    // Skip header line
    if (lineNum > 0 && end > start) {
      const fideId = buf.toString("utf-8", start, start + 15).trim();

      if (fideId && /^\d+$/.test(fideId) && (!filterIds || filterIds.has(fideId))) {
        const name = buf.toString("utf-8", start + 15, start + 76).trim();
        const federation = buf.toString("utf-8", start + 76, start + 79).trim();
        const title = buf.toString("utf-8", start + 84, start + 88).trim() || null;

        const sRtng = parseInt(buf.toString("utf-8", start + 113, start + 119).trim(), 10);
        const rRtng = parseInt(buf.toString("utf-8", start + 126, start + 132).trim(), 10);
        const bRtng = parseInt(buf.toString("utf-8", start + 139, start + 145).trim(), 10);
        const birthStr = buf.toString("utf-8", start + 152, start + 156).trim();
        const birthYear = birthStr ? parseInt(birthStr, 10) : null;

        result.set(fideId, {
          name,
          federation,
          title,
          birthYear: birthYear && !isNaN(birthYear) ? birthYear : null,
          standardRating: sRtng && !isNaN(sRtng) ? sRtng : null,
          rapidRating: rRtng && !isNaN(rRtng) ? rRtng : null,
          blitzRating: bRtng && !isNaN(bRtng) ? bRtng : null,
        });
      }
    }

    start = end + 1;
    lineNum++;
  }

  return result;
}

/**
 * Load the unified FIDE rating list from a zip file.
 *
 * The zip contains a single file (players_list_foa.txt) with all 3 rating
 * types per player. Unzips to a temp directory to avoid polluting the repo.
 * Returns a Map of FIDE ID → MergedFideRecord.
 */
/**
 * Load the unified FIDE rating list from a zip file.
 *
 * When `filterIds` is provided, only records matching those FIDE IDs are loaded.
 * This avoids loading ~1M records when only ~80K are needed.
 */
export function loadFideData(
  ratingsDir: string,
  filterIds?: Set<string>
): Map<string, MergedFideRecord> {
  const zipPath = join(ratingsDir, "players_list.zip");
  if (!existsSync(zipPath)) {
    console.warn(`[fide-enrichment] Zip not found: ${zipPath}. Skipping enrichment.`);
    return new Map();
  }

  // Unzip to temp dir
  const tmpDir = join(tmpdir(), "fide-ratings-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });

  console.log(`  Unzipping FIDE rating list to ${tmpDir}...`);
  execSync(`unzip -o -q "${zipPath}" -d "${tmpDir}"`, { stdio: "pipe" });

  // Find the single .txt file in the extracted contents
  const txtFile = readdirSync(tmpDir).find((f) => f.endsWith(".txt"));
  if (!txtFile) {
    console.warn(`[fide-enrichment] No .txt file found in zip. Skipping enrichment.`);
    return new Map();
  }

  const txtPath = join(tmpDir, txtFile);
  console.log(`  Parsing unified FIDE rating list: ${txtFile}...`);
  const fideData = parseFideUnifiedList(txtPath, filterIds);

  console.log(`  Parsed: ${fideData.size} FIDE players${filterIds ? ` (filtered from ${filterIds.size} IDs)` : ""}`);

  // Clean up temp dir (best effort)
  try {
    execSync(`rm -rf "${tmpDir}"`, { stdio: "pipe" });
  } catch {
    // Non-fatal
  }

  return fideData;
}

/**
 * Enrich player data with official FIDE names and ratings.
 *
 * For each player with a matching FIDE ID:
 * - Replaces name with official FIDE full name
 * - Adds federation, birthYear, and all 3 official ratings
 * - Regenerates slug and aliases with the new name
 *
 * Mutates players in place. Returns the count of enriched players.
 */
export function enrichPlayers(
  players: FIDEPlayer[],
  fideData: Map<string, MergedFideRecord>
): number {
  let enriched = 0;

  for (const player of players) {
    const fide = fideData.get(player.fideId);
    if (!fide) continue;

    // Save old name as alias source before replacing
    const oldName = player.name;

    // Replace name with official FIDE name
    if (fide.name && fide.name.length > 0) {
      player.name = fide.name;
    }

    // Set official ratings
    if (fide.standardRating) player.standardRating = fide.standardRating;
    if (fide.rapidRating) player.rapidRating = fide.rapidRating;
    if (fide.blitzRating) player.blitzRating = fide.blitzRating;

    // Set federation and birth year
    if (fide.federation) player.federation = fide.federation;
    if (fide.birthYear) player.birthYear = fide.birthYear;

    // Update title if FIDE has one and we don't (or FIDE's is different)
    if (fide.title && !player.title) {
      player.title = fide.title;
    }

    // Regenerate slug with new name
    const newSlug = generateSlug(player.name, player.fideId);

    // Generate aliases from both old and new names
    const nameVariants = new Set<string>();
    nameVariants.add(player.name); // FIDE name: "Caruana, Fabiano"
    nameVariants.add(oldName); // TWIC name: "Caruana,F"

    // Also add the old aliases as name sources (they might have been from other TWIC variants)
    const oldAliases = player.aliases;
    const oldSlug = player.slug;

    player.slug = newSlug;
    player.aliases = generateAliases(nameVariants, player.fideId, newSlug);

    // Also add the old slug as an alias if it changed
    if (oldSlug !== newSlug && !player.aliases.includes(oldSlug)) {
      player.aliases.push(oldSlug);
    }

    // Add old aliases that aren't the new canonical
    for (const alias of oldAliases) {
      if (alias !== newSlug && !player.aliases.includes(alias)) {
        player.aliases.push(alias);
      }
    }

    enriched++;
  }

  return enriched;
}

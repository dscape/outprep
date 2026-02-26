/**
 * FIDE name & rating enrichment.
 *
 * Parses official FIDE rating list TXT files (fixed-width format) and enriches
 * pipeline player data with full names, official ratings (Standard/Rapid/Blitz),
 * federation, and birth year.
 *
 * FIDE TXT column layout:
 *   Cols 1-15:    ID Number (FIDE ID)
 *   Cols 16-76:   Name ("Caruana, Fabiano")
 *   Cols 77-79:   Federation ("USA")
 *   Col  81:      Sex
 *   Cols 85-88:   Title ("GM  ")
 *   Cols 113-118: Rating
 *   Cols 125-128: Birth year
 */

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { generateSlug, generateAliases } from "./aggregate";
import type { FIDEPlayer } from "./types";

/** A single record from one FIDE rating list. */
export interface FideRecord {
  name: string; // "Caruana, Fabiano"
  federation: string; // "USA"
  title: string | null; // "GM", "IM", etc.
  rating: number | null;
  birthYear: number | null;
}

/** Merged record across Standard, Rapid, and Blitz lists. */
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
 * Parse a single FIDE rating list TXT file (fixed-width format).
 * Returns a Map of FIDE ID → FideRecord.
 */
export function parseFideRatingList(txtPath: string): Map<string, FideRecord> {
  const content = readFileSync(txtPath, "utf-8");
  const lines = content.split("\n");
  const result = new Map<string, FideRecord>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip header and empty lines
    if (i === 0 || line.trim() === "") continue;

    const fideId = line.slice(0, 15).trim();
    if (!fideId || !/^\d+$/.test(fideId)) continue;

    const name = line.slice(15, 76).trim();
    const federation = line.slice(76, 79).trim();
    const title = line.slice(84, 88).trim() || null;
    const ratingStr = line.slice(112, 118).trim();
    const rating = ratingStr ? parseInt(ratingStr, 10) : null;
    const birthStr = line.slice(124, 128).trim();
    const birthYear = birthStr ? parseInt(birthStr, 10) : null;

    result.set(fideId, {
      name,
      federation,
      title,
      rating: rating && !isNaN(rating) ? rating : null,
      birthYear: birthYear && !isNaN(birthYear) ? birthYear : null,
    });
  }

  return result;
}

/**
 * Load and merge all 3 FIDE rating lists from a zip file.
 *
 * Unzips to a temp directory to avoid polluting the repo.
 * Returns a Map of FIDE ID → MergedFideRecord.
 */
export function loadFideData(ratingsDir: string): Map<string, MergedFideRecord> {
  const zipPath = join(ratingsDir, "fide_ratings_and_names.zip");
  if (!existsSync(zipPath)) {
    console.warn(`[fide-enrichment] Zip not found: ${zipPath}. Skipping enrichment.`);
    return new Map();
  }

  // Unzip to temp dir
  const tmpDir = join(tmpdir(), "fide-ratings-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });

  console.log(`  Unzipping FIDE rating lists to ${tmpDir}...`);
  execSync(`unzip -o -q "${zipPath}" -d "${tmpDir}"`, { stdio: "pipe" });

  const standardPath = join(tmpDir, "standard_rating_list.txt");
  const rapidPath = join(tmpDir, "rapid_rating_list.txt");
  const blitzPath = join(tmpDir, "blitz_rating_list.txt");

  // Parse each list that exists
  const standardMap = existsSync(standardPath) ? parseFideRatingList(standardPath) : new Map<string, FideRecord>();
  const rapidMap = existsSync(rapidPath) ? parseFideRatingList(rapidPath) : new Map<string, FideRecord>();
  const blitzMap = existsSync(blitzPath) ? parseFideRatingList(blitzPath) : new Map<string, FideRecord>();

  console.log(`  Parsed: standard=${standardMap.size}, rapid=${rapidMap.size}, blitz=${blitzMap.size}`);

  // Merge: standard is primary source for name/federation/title/birthYear
  const merged = new Map<string, MergedFideRecord>();

  // Start with all standard players
  for (const [id, rec] of standardMap) {
    merged.set(id, {
      name: rec.name,
      federation: rec.federation,
      title: rec.title,
      birthYear: rec.birthYear,
      standardRating: rec.rating,
      rapidRating: rapidMap.get(id)?.rating ?? null,
      blitzRating: blitzMap.get(id)?.rating ?? null,
    });
  }

  // Add rapid-only players (not in standard)
  for (const [id, rec] of rapidMap) {
    if (!merged.has(id)) {
      merged.set(id, {
        name: rec.name,
        federation: rec.federation,
        title: rec.title,
        birthYear: rec.birthYear,
        standardRating: null,
        rapidRating: rec.rating,
        blitzRating: blitzMap.get(id)?.rating ?? null,
      });
    }
  }

  // Add blitz-only players (not in standard or rapid)
  for (const [id, rec] of blitzMap) {
    if (!merged.has(id)) {
      merged.set(id, {
        name: rec.name,
        federation: rec.federation,
        title: rec.title,
        birthYear: rec.birthYear,
        standardRating: null,
        rapidRating: null,
        blitzRating: rec.rating,
      });
    }
  }

  console.log(`  Merged: ${merged.size} total FIDE players`);

  // Clean up temp dir (best effort)
  try {
    execSync(`rm -rf "${tmpDir}"`, { stdio: "pipe" });
  } catch {
    // Non-fatal
  }

  return merged;
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

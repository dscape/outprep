/**
 * Generate eco-names.ts for the FIDE pipeline.
 *
 * Reads the eco-classifier.ts data (3641 entries) and extracts:
 * - ECO code → opening family name (before first colon)
 * - For each ECO code, picks the shortest/most general name
 *
 * Output: packages/fide-pipeline/src/eco-names.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Parse the raw entries from eco-classifier.ts
const src = readFileSync(join(ROOT, "src/lib/analysis/eco-classifier.ts"), "utf-8");

// Extract all [eco, name, moves] tuples
const tuples: [string, string][] = [];
const regex = /\["([A-E]\d{2})","([^"]+)"/g;
let match;
while ((match = regex.exec(src)) !== null) {
  tuples.push([match[1], match[2]]);
}

console.log(`Parsed ${tuples.length} entries from eco-classifier.ts`);

// Group by ECO code, pick the shortest name per code (most general)
const ecoMap = new Map<string, string>();
for (const [eco, name] of tuples) {
  const existing = ecoMap.get(eco);
  if (!existing || name.length < existing.length) {
    ecoMap.set(eco, name);
  }
}

console.log(`${ecoMap.size} unique ECO codes`);

// Generate the output
const entries = Array.from(ecoMap.entries())
  .sort(([a], [b]) => a.localeCompare(b));

const lines = [
  `/**`,
  ` * ECO code → opening name lookup map.`,
  ` *`,
  ` * Auto-generated from src/lib/analysis/eco-classifier.ts (Lichess chess-openings, CC0).`,
  ` * Run: npx tsx scripts/generate-eco-names.ts`,
  ` */`,
  ``,
  `export const ECO_NAMES: Record<string, string> = {`,
];

for (const [eco, name] of entries) {
  lines.push(`  "${eco}": ${JSON.stringify(name)},`);
}

lines.push(`};`);
lines.push(``);

const outPath = join(ROOT, "packages/fide-pipeline/src/eco-names.ts");
writeFileSync(outPath, lines.join("\n"));
console.log(`Written ${outPath} (${entries.length} entries)`);

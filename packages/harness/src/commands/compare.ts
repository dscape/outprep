/**
 * compare command — loads multiple result files and prints side-by-side comparison.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatComparison } from "../format";
import type { TestResult } from "../types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "../../results");

export async function compare(resultNames: string[]) {
  if (resultNames.length < 1) {
    console.error("Please provide at least one result to compare.");
    process.exit(1);
  }

  const results: TestResult[] = [];

  for (const name of resultNames) {
    // Try exact path first, then results directory, then glob by label
    let resultPath: string | null = null;

    if (existsSync(name)) {
      resultPath = name;
    } else if (existsSync(join(RESULTS_DIR, name))) {
      resultPath = join(RESULTS_DIR, name);
    } else if (existsSync(join(RESULTS_DIR, `${name}.json`))) {
      resultPath = join(RESULTS_DIR, `${name}.json`);
    } else {
      // Search for files matching the label
      if (existsSync(RESULTS_DIR)) {
        const files = readdirSync(RESULTS_DIR).filter(
          (f) => f.includes(name) && f.endsWith(".json")
        );
        if (files.length > 0) {
          // Use the most recent file matching the label
          const sorted = files.sort().reverse();
          resultPath = join(RESULTS_DIR, sorted[0]);
          if (files.length > 1) {
            console.log(
              `  Found ${files.length} results matching "${name}", using most recent: ${sorted[0]}`
            );
          }
        }
      }
    }

    if (!resultPath) {
      console.error(`Result not found: ${name}`);
      console.error(`  Searched: ${name}, ${RESULTS_DIR}/${name}[.json]`);
      process.exit(1);
    }

    try {
      const result: TestResult = JSON.parse(
        readFileSync(resultPath, "utf-8")
      );
      results.push(result);
      console.log(`  Loaded: ${resultPath} (label: "${result.label}")`);
    } catch {
      console.error(`Failed to parse result file: ${resultPath}`);
      process.exit(1);
    }
  }

  console.log(formatComparison(results));
}

/**
 * forge.config.* — Config get/set/reset operations.
 *
 * Reads and modifies the DEFAULT_CONFIG in the sandbox engine's config.ts.
 * Changes are tracked as ConfigChangeRecords for experiment logging.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SandboxInfo } from "./sandbox";
import { revertFile } from "./sandbox";
import type { ConfigChangeRecord } from "../state/types";
import type { BotConfig } from "@outprep/engine";

/* ── Change tracker ────────────────────────────────────────── */

const configChangesBySession = new Map<string, ConfigChangeRecord[]>();

function getConfigChanges(sessionId: string): ConfigChangeRecord[] {
  if (!configChangesBySession.has(sessionId)) {
    configChangesBySession.set(sessionId, []);
  }
  return configChangesBySession.get(sessionId)!;
}

/* ── File path helper ──────────────────────────────────────── */

function configFilePath(sandbox: SandboxInfo): string {
  return join(sandbox.enginePath, "src", "config.ts");
}

/* ── Deep get/set by dot-path ──────────────────────────────── */

/**
 * Get a nested value from an object by dot-path.
 * E.g. getByPath(obj, "boltzmann.temperatureScale") => 15
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Parse the DEFAULT_CONFIG object from config.ts source code.
 *
 * Strategy: extract the object literal between the first `{` after
 * `DEFAULT_CONFIG` and its matching `}`, then evaluate it using
 * Function() to get a real JS object.
 */
function parseConfigFromSource(source: string): BotConfig {
  const marker = "export const DEFAULT_CONFIG";
  const startIdx = source.indexOf(marker);
  if (startIdx === -1) {
    throw new Error("Could not find DEFAULT_CONFIG in config.ts");
  }

  // Find the opening brace
  const braceStart = source.indexOf("{", startIdx);
  if (braceStart === -1) {
    throw new Error("Could not find opening brace for DEFAULT_CONFIG");
  }

  // Match braces to find the end
  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
  }

  if (braceEnd === -1) {
    throw new Error("Could not find closing brace for DEFAULT_CONFIG");
  }

  const objectLiteral = source.slice(braceStart, braceEnd + 1);

  // Use Function constructor to safely evaluate the object literal
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(`return (${objectLiteral})`);
  return fn() as BotConfig;
}

/**
 * Replace a specific value in the DEFAULT_CONFIG source at a given dot-path.
 *
 * Strategy: Walk the source text structure to find the value at the path,
 * then perform a targeted string replacement.
 */
function replaceConfigValue(
  source: string,
  path: string,
  newValue: unknown
): string {
  const keys = path.split(".");
  const serializedValue = JSON.stringify(newValue);

  // For simple cases, find the key and replace its value
  // Walk into nested objects by finding each key in sequence

  const marker = "export const DEFAULT_CONFIG";
  let searchStart = source.indexOf(marker);
  if (searchStart === -1) {
    throw new Error("Could not find DEFAULT_CONFIG in config.ts");
  }

  // Navigate to each key level
  for (let i = 0; i < keys.length - 1; i++) {
    const keyPattern = new RegExp(
      `(?:${keys[i]}\\s*:|"${keys[i]}"\\s*:)`,
      "g"
    );
    keyPattern.lastIndex = searchStart;
    const match = keyPattern.exec(source);
    if (!match) {
      throw new Error(
        `Could not find key "${keys[i]}" in path "${path}" in config.ts`
      );
    }
    searchStart = match.index + match[0].length;
  }

  // Find the final key
  const finalKey = keys[keys.length - 1];
  const finalKeyPattern = new RegExp(
    `((?:${finalKey}\\s*:|"${finalKey}"\\s*:)\\s*)`,
    "g"
  );
  finalKeyPattern.lastIndex = searchStart;
  const finalMatch = finalKeyPattern.exec(source);
  if (!finalMatch) {
    throw new Error(
      `Could not find final key "${finalKey}" in path "${path}" in config.ts`
    );
  }

  const valueStart = finalMatch.index + finalMatch[0].length;

  // Determine the extent of the current value
  // It could be a number, string, boolean, array, or object
  let valueEnd: number;
  const firstChar = source[valueStart];

  if (firstChar === "{" || firstChar === "[") {
    // Find matching brace/bracket
    const open = firstChar;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    valueEnd = valueStart;
    for (let i = valueStart; i < source.length; i++) {
      if (source[i] === open) depth++;
      else if (source[i] === close) {
        depth--;
        if (depth === 0) {
          valueEnd = i + 1;
          break;
        }
      }
    }
  } else if (firstChar === '"' || firstChar === "'") {
    // String value — find the matching quote
    const quote = firstChar;
    valueEnd = source.indexOf(quote, valueStart + 1) + 1;
  } else {
    // Number, boolean, or identifier — scan until comma, newline, or closing brace
    valueEnd = valueStart;
    for (let i = valueStart; i < source.length; i++) {
      if (",\n}]".includes(source[i])) {
        valueEnd = i;
        break;
      }
    }
  }

  const oldValueStr = source.slice(valueStart, valueEnd).trim();
  const before = source.slice(0, valueStart);
  const after = source.slice(valueEnd);

  // Preserve formatting: if old value was multi-line, use pretty-print
  let replacement: string;
  if (
    typeof newValue === "object" &&
    newValue !== null &&
    oldValueStr.includes("\n")
  ) {
    // Multi-line object/array — indent to match context
    const lineStart = source.lastIndexOf("\n", valueStart);
    const indent = source.slice(lineStart + 1, valueStart).replace(/\S.*/, "");
    replacement = JSON.stringify(newValue, null, 2)
      .split("\n")
      .map((line, i) => (i === 0 ? line : indent + line))
      .join("\n");
  } else {
    replacement = serializedValue;
  }

  return before + replacement + after;
}

/* ── Public API ────────────────────────────────────────────── */

export interface ConfigOps {
  get(): BotConfig;
  set(path: string, value: unknown): void;
  reset(): void;
  /** Access tracked config changes (for experiment logging). */
  getTrackedChanges(): ConfigChangeRecord[];
}

export function createConfigOps(sandbox: SandboxInfo): ConfigOps {
  return {
    get(): BotConfig {
      const source = readFileSync(configFilePath(sandbox), "utf-8");
      return parseConfigFromSource(source);
    },

    set(path: string, value: unknown): void {
      const filePath = configFilePath(sandbox);
      const source = readFileSync(filePath, "utf-8");

      // Read old value for change tracking
      const currentConfig = parseConfigFromSource(source);
      const oldValue = getByPath(
        currentConfig as unknown as Record<string, unknown>,
        path
      );

      // Replace value in source
      const updated = replaceConfigValue(source, path, value);
      writeFileSync(filePath, updated, "utf-8");

      // Track change
      const change: ConfigChangeRecord = {
        path,
        oldValue,
        newValue: value,
        description: `config.set("${path}", ${JSON.stringify(value)})`,
      };
      getConfigChanges(sandbox.sessionId).push(change);
    },

    reset(): void {
      revertFile(sandbox, "src/config.ts");
      // Clear tracked config changes
      configChangesBySession.set(sandbox.sessionId, []);
    },

    getTrackedChanges(): ConfigChangeRecord[] {
      return getConfigChanges(sandbox.sessionId);
    },
  };
}

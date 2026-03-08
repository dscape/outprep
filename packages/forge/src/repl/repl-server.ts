/**
 * Persistent TypeScript REPL server.
 *
 * Creates a VM context where the `forge` object is available as a global.
 * The agent sends TypeScript/JavaScript code strings, and this module
 * executes them in a persistent sandbox (variables survive across calls).
 *
 * Key design decisions:
 * - Uses Node.js `vm` module with a persistent context
 * - Async code supported: wraps in async IIFE automatically
 * - console.log intercepted and captured in output
 * - Timeout protection (default 5 min per execution)
 * - Errors caught and returned without crashing the server
 */

import vm from "node:vm";

/* ── Types ─────────────────────────────────────────────────── */

export interface ReplResult {
  /** Captured console output (log, warn, error, info) */
  output: string;
  /** Return value of the last expression */
  result: unknown;
  /** Error message if execution failed */
  error?: string;
  /** Wall-clock execution time in milliseconds */
  durationMs: number;
}

export interface ReplServer {
  /** Execute a code string in the persistent context. */
  execute(code: string, timeoutMs?: number): Promise<ReplResult>;
  /** Inject a value into the REPL context (available as a global). */
  inject(name: string, value: unknown): void;
  /** Reset the REPL context (clear all variables). */
  reset(): void;
  /** Destroy the REPL server and release resources. */
  dispose(): void;
}

/* ── Console capture ───────────────────────────────────────── */

interface CapturedConsole {
  log: typeof console.log;
  warn: typeof console.warn;
  error: typeof console.error;
  info: typeof console.info;
  lines: string[];
}

function createCapturedConsole(): CapturedConsole {
  const lines: string[] = [];

  function capture(...args: unknown[]): void {
    const line = args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a, null, 2);
        } catch {
          return String(a);
        }
      })
      .join(" ");
    lines.push(line);
  }

  return {
    log: capture,
    warn: (...args: unknown[]) => capture("[warn]", ...args),
    error: (...args: unknown[]) => capture("[error]", ...args),
    info: (...args: unknown[]) => capture("[info]", ...args),
    lines,
  };
}

/* ── Serialize result for display ──────────────────────────── */

function serializeResult(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return value.toString();

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/* ── Wrap code for async execution ─────────────────────────── */

/**
 * Wrap user code in an async IIFE so that:
 * 1. `await` works at the top level
 * 2. The last expression's value is returned
 *
 * If the code doesn't contain await, we still wrap it to support
 * both sync and async code uniformly.
 */
function wrapInAsyncIIFE(code: string): string {
  // Trim trailing semicolons/whitespace from the last expression
  // so the async IIFE returns its value
  const trimmed = code.trimEnd();

  // Try to detect if the last statement is an expression (not a declaration)
  // by checking if it doesn't start with certain keywords
  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1].trim();

  const isDeclaration =
    lastLine.startsWith("const ") ||
    lastLine.startsWith("let ") ||
    lastLine.startsWith("var ") ||
    lastLine.startsWith("function ") ||
    lastLine.startsWith("class ") ||
    lastLine.startsWith("if ") ||
    lastLine.startsWith("if(") ||
    lastLine.startsWith("for ") ||
    lastLine.startsWith("for(") ||
    lastLine.startsWith("while ") ||
    lastLine.startsWith("while(") ||
    lastLine.startsWith("switch ") ||
    lastLine.startsWith("switch(") ||
    lastLine.startsWith("try ") ||
    lastLine.startsWith("try{") ||
    lastLine.startsWith("//") ||
    lastLine.startsWith("/*") ||
    lastLine === "" ||
    lastLine === "}";

  if (isDeclaration) {
    // The last line is a declaration/statement, don't try to return it
    return `(async () => { ${trimmed} })()`;
  }

  // The last line is likely an expression — return it
  // Replace the last line with `return lastLine`
  const prefix = lines.slice(0, -1).join("\n");
  const lastExpr = lastLine.replace(/;$/, "");

  if (prefix) {
    return `(async () => { ${prefix}\n  return (${lastExpr}); })()`;
  }
  return `(async () => { return (${lastExpr}); })()`;
}

/* ── REPL Server creation ──────────────────────────────────── */

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function createReplServer(globals?: Record<string, unknown>): ReplServer {
  // Build the initial context with common globals
  let contextObj: Record<string, unknown> = {
    // Standard globals that vm contexts need
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    JSON,
    Math,
    Date,
    RegExp,
    Array,
    Object,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    // Inject any provided globals (the forge object goes here)
    ...globals,
  };

  let context = vm.createContext(contextObj);

  return {
    async execute(
      code: string,
      timeoutMs: number = DEFAULT_TIMEOUT_MS
    ): Promise<ReplResult> {
      const startTime = Date.now();
      const captured = createCapturedConsole();

      // Inject captured console into the context
      contextObj.console = captured;
      // Re-sync context (vm context reflects mutations to contextObj)

      try {
        // Wrap code for async support
        const wrappedCode = wrapInAsyncIIFE(code);

        // Compile and run in the persistent context
        const script = new vm.Script(wrappedCode, {
          filename: "forge-repl",
        });

        // Run the script — returns a Promise from the async IIFE
        const promise = script.runInContext(context, {
          timeout: timeoutMs,
        });

        // Await the result (handles both sync and async code)
        let result: unknown;
        if (promise && typeof promise === "object" && "then" in promise) {
          // It's a Promise — await with timeout
          result = await Promise.race([
            promise,
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`Execution timed out after ${timeoutMs}ms`)),
                timeoutMs
              )
            ),
          ]);
        } else {
          result = promise;
        }

        const durationMs = Date.now() - startTime;

        return {
          output: captured.lines.join("\n"),
          result,
          durationMs,
        };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errorMessage =
          err instanceof Error ? err.message : String(err);

        return {
          output: captured.lines.join("\n"),
          result: undefined,
          error: errorMessage,
          durationMs,
        };
      }
    },

    inject(name: string, value: unknown): void {
      contextObj[name] = value;
      // Update the VM context
      try {
        const assignScript = new vm.Script(`void 0`);
        assignScript.runInContext(context);
      } catch {
        // Context update happens through the proxy; the script is a no-op
      }
    },

    reset(): void {
      // Preserve injected globals (forge, etc.) but clear user-defined vars
      const preserved: Record<string, unknown> = {};
      for (const key of Object.keys(contextObj)) {
        preserved[key] = contextObj[key];
      }
      contextObj = { ...preserved };
      context = vm.createContext(contextObj);
    },

    dispose(): void {
      // Clear references to help GC
      contextObj = {};
      context = vm.createContext({});
    },
  };
}

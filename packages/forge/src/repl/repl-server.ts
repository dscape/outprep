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
  /** Get tab-completion candidates for a dotted expression (e.g. "forge.co"). */
  complete(line: string): [string[], string];
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

/* ── Hoist declarations for persistence ────────────────────── */

/**
 * Transform top-level `const`/`let` declarations into bare assignments
 * so they persist on the vm.Context between REPL calls.
 *
 * `const foo = expr` → `foo = expr`  (bare assignment → context global)
 * `const { a, b } = expr` → `({ a, b } = expr)`
 * `const [a, b] = expr` → `([a, b] = expr)`
 *
 * Only transforms at brace-depth 0 (top level). Skips declarations
 * inside control-flow statements (for, while, if) and function bodies.
 */
function hoistDeclarations(code: string): string {
  const lines = code.split("\n");
  let braceDepth = 0;

  const result = lines.map((line) => {
    const trimmed = line.trimStart();
    const indent = line.slice(0, line.length - trimmed.length);

    // Update brace depth BEFORE processing (opening braces from previous lines)
    // We count braces to know if we're at the top level
    if (braceDepth === 0) {
      // Skip control-flow declarations — these need their own scope
      const isControlFlow =
        /^(for|while|if|switch|try|catch)\s*[\s(]/.test(trimmed) ||
        /^(for|while|if|switch|try|catch)\{/.test(trimmed);

      if (!isControlFlow) {
        // Match: const/let identifier = ...
        const simpleMatch = trimmed.match(/^(const|let)\s+([\w$]+)\s*=/);
        if (simpleMatch) {
          line = indent + trimmed.replace(/^(const|let)\s+/, "");
        }

        // Match: const/let { ... } = ...
        const objDestructMatch = trimmed.match(/^(const|let)\s+(\{[^}]+\})\s*=/);
        if (objDestructMatch) {
          const rest = trimmed.replace(/^(const|let)\s+/, "");
          line = indent + "(" + rest.replace(/;\s*$/, "") + ");";
        }

        // Match: const/let [ ... ] = ...
        const arrDestructMatch = trimmed.match(/^(const|let)\s+(\[[^\]]+\])\s*=/);
        if (arrDestructMatch) {
          const rest = trimmed.replace(/^(const|let)\s+/, "");
          line = indent + "(" + rest.replace(/;\s*$/, "") + ");";
        }
      }
    }

    // Track brace depth for next iteration
    for (const ch of trimmed) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
    }

    return line;
  });

  return result.join("\n");
}

/* ── Wrap code for async execution ─────────────────────────── */

/**
 * Wrap user code in an async IIFE so that:
 * 1. `await` works at the top level
 * 2. The last expression's value is returned
 *
 * Top-level const/let declarations are hoisted to bare assignments
 * so they persist on the vm.Context between calls.
 */
function wrapInAsyncIIFE(code: string): string {
  // Hoist declarations so variables persist across REPL calls
  const hoisted = hoistDeclarations(code);
  const trimmed = hoisted.trimEnd();

  // Try to detect if the last statement is an expression (not a declaration)
  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1].trim();

  const isStatement =
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
    lastLine.startsWith("}");

  // After hoisting, a bare assignment like `foo = expr` is not a "declaration"
  // so it can potentially be returned as a value
  const isAssignment = /^[\w$]+\s*=\s/.test(lastLine) && !lastLine.startsWith("==");

  if (isStatement || isAssignment) {
    return `(async () => { ${trimmed} })()`;
  }

  // The last line is likely an expression — return it
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
    // Stub require to give a helpful error instead of "require is not defined"
    require: () => {
      throw new Error(
        "require() is not available in the forge REPL. Use the pre-injected `forge` and `playerData` globals instead."
      );
    },
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
          // Use unref() so the timer doesn't keep the process alive
          let timer: ReturnType<typeof setTimeout>;
          result = await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`Execution timed out after ${timeoutMs}ms`)),
                timeoutMs
              );
              timer.unref();
            }),
          ]);
          clearTimeout(timer!);
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

    complete(line: string): [string[], string] {
      // Extract the dotted expression being typed (e.g. "forge.co" from "const x = forge.co")
      const match = line.match(/([\w.]+)$/);
      if (!match) return [[], line];
      const expr = match[1];

      const parts = expr.split(".");
      // Walk the context object along the dot-path
      let obj: unknown = contextObj;
      for (let i = 0; i < parts.length - 1; i++) {
        if (obj == null || typeof obj !== "object") return [[], expr];
        obj = (obj as Record<string, unknown>)[parts[i]];
      }

      if (obj == null || typeof obj !== "object") return [[], expr];

      const prefix = parts.slice(0, -1).join(".");
      const partial = parts[parts.length - 1];
      const keys = Object.keys(obj as Record<string, unknown>);
      const hits = keys
        .filter((k) => k.startsWith(partial))
        .map((k) => (prefix ? `${prefix}.${k}` : k));

      return [hits, expr];
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

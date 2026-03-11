/**
 * forge.eval.* — Harness execution inside the sandbox.
 *
 * The key challenge: running the harness with the SANDBOX's engine
 * instead of the workspace engine. We solve this by spawning a
 * child process (tsx) in the sandbox worktree. The subprocess's
 * module resolution naturally picks up the sandbox's @outprep/engine.
 *
 * The _eval-worker.ts script is the subprocess entry point.
 */

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SandboxInfo } from "./sandbox";
import type { TestResult, Metrics } from "@outprep/harness";
import type { LichessGame } from "@outprep/harness";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const tsxBin = join(REPO_ROOT, "node_modules", ".bin", "tsx");

/* ── Worker protocol types (must match _eval-worker.ts) ───── */

interface EvalWorkerInput {
  dataset: {
    name: string;
    username: string;
    estimatedElo: number;
    speeds: string[];
    createdAt: string;
    gameCount: number;
    gamesWithEvals: number;
    games: LichessGame[];
  };
  runConfig: {
    seed: number;
    label: string;
    eloOverride?: number;
    configOverrides?: Record<string, unknown>;
    maxPositions?: number;
    skipTopN?: boolean;
    phaseBalanced?: boolean;
  };
  /** Train games for profile building (train/test separation). */
  trainGames?: LichessGame[];
}

interface EvalWorkerOutput {
  success: boolean;
  result?: TestResult;
  error?: string;
}

/* ── Options ───────────────────────────────────────────────── */

export interface EvalOptions {
  seed?: number;
  label?: string;
  maxPositions?: number;
  skipTopN?: boolean;
  phaseBalanced?: boolean;
  timeoutMs?: number;
  /**
   * Train games for profile building (train/test separation).
   * When provided, profiles (error profile, opening trie, style metrics)
   * are built from these games instead of from the evaluation dataset.
   * This prevents data leakage, especially through the opening trie.
   */
  trainGames?: LichessGame[];
}

/* ── Comparison table ──────────────────────────────────────── */

export interface ComparisonTable {
  rows: ComparisonRow[];
  summary: string;
}

export interface ComparisonRow {
  metric: string;
  baseline: number;
  experiment: number;
  delta: number;
  deltaPercent: number;
  improved: boolean;
}

/* ── NaN restoration after JSON round-trip ─────────────────── */

/**
 * JSON.stringify(NaN) produces null. After JSON.parse, restore null → NaN
 * for numeric metric fields that legitimately use NaN (no data available).
 */
function restoreMetricNaNs(result: TestResult): void {
  const m = result.metrics;
  if (m.avgActualCPL === null) (m as any).avgActualCPL = NaN;
  if (m.avgBotCPL === null) (m as any).avgBotCPL = NaN;
  if (m.cplDelta === null) (m as any).cplDelta = NaN;

  if (m.byPhase) {
    for (const phase of Object.values(m.byPhase)) {
      if (phase.avgCPL === null) (phase as any).avgCPL = NaN;
      if (phase.botAvgCPL === null) (phase as any).botAvgCPL = NaN;
    }
  }
}

/* ── Spawn the eval worker in the sandbox ──────────────────── */

/**
 * Run the eval worker as a subprocess in the sandbox worktree.
 * The worker script path is always the ORIGINAL (non-sandbox) path
 * since the forge code itself doesn't change — only the engine does.
 */
async function runWorker(
  sandbox: SandboxInfo,
  input: EvalWorkerInput,
  timeoutMs: number
): Promise<TestResult> {
  const workerScript = join(__dirname, "_eval-worker.ts");

  return new Promise<TestResult>((resolve, reject) => {
    const child = spawn(tsxBin, [workerScript], {
      cwd: sandbox.worktreePath,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Force Node to resolve workspace packages from the sandbox
        NODE_PATH: join(sandbox.worktreePath, "node_modules"),
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      // Forward progress to parent's stderr for visibility
      process.stderr.write(data);
    });

    // Write input and close stdin
    const inputJson = JSON.stringify(input);
    child.stdin.write(inputJson);
    child.stdin.end();

    // Timeout protection
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(`Eval worker timed out after ${timeoutMs}ms`)
      );
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0 && !stdout) {
        reject(
          new Error(
            `Eval worker exited with code ${code}.\nstderr: ${stderr.slice(-2000)}`
          )
        );
        return;
      }

      try {
        const output: EvalWorkerOutput = JSON.parse(stdout);
        if (output.success && output.result) {
          restoreMetricNaNs(output.result);
          resolve(output.result);
        } else {
          reject(
            new Error(output.error ?? "Eval worker returned no result")
          );
        }
      } catch (parseErr) {
        reject(
          new Error(
            `Failed to parse eval worker output: ${parseErr}\nstdout: ${stdout.slice(0, 500)}\nstderr: ${stderr.slice(-500)}`
          )
        );
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn eval worker: ${err.message}`));
    });
  });
}

/* ── Build a Dataset from LichessGames ─────────────────────── */

function buildDataset(
  games: LichessGame[],
  label: string
): EvalWorkerInput["dataset"] {
  // Infer username from the games (take the most common player)
  const userCounts = new Map<string, number>();
  for (const game of games) {
    for (const side of ["white", "black"] as const) {
      const id = game.players[side]?.user?.id;
      if (id) userCounts.set(id, (userCounts.get(id) ?? 0) + 1);
    }
  }
  let username = "unknown";
  let maxCount = 0;
  for (const [id, count] of userCounts) {
    if (count > maxCount) {
      username = id;
      maxCount = count;
    }
  }

  // Estimate elo from average rating across games
  let totalElo = 0;
  let eloCount = 0;
  for (const game of games) {
    for (const side of ["white", "black"] as const) {
      const id = game.players[side]?.user?.id;
      const rating = game.players[side]?.rating;
      if (id?.toLowerCase() === username.toLowerCase() && rating) {
        totalElo += rating;
        eloCount++;
      }
    }
  }
  const estimatedElo = eloCount > 0 ? Math.round(totalElo / eloCount) : 1500;

  const gamesWithEvals = games.filter(
    (g) => g.analysis && g.analysis.length > 0
  ).length;

  return {
    name: label,
    username,
    estimatedElo,
    speeds: [...new Set(games.map((g) => g.speed))],
    createdAt: new Date().toISOString(),
    gameCount: games.length,
    gamesWithEvals,
    games,
  };
}

/* ── Public API ────────────────────────────────────────────── */

export interface EvalOps {
  /**
   * Run a full evaluation on testGames.
   * @param testGames Games to evaluate accuracy on.
   * @param opts Options including trainGames for proper train/test separation.
   */
  run(testGames: LichessGame[], opts?: EvalOptions): Promise<TestResult>;
  /**
   * Quick triage evaluation (50 positions by default, skipTopN).
   * @param testGames Games to evaluate.
   * @param trainGames Optional train games for profile building.
   * @param n Max positions (default 50).
   */
  runQuick(testGames: LichessGame[], trainGames?: LichessGame[], n?: number): Promise<TestResult>;
  /**
   * Run baseline evaluation (no config overrides).
   * @param testGames Games to evaluate.
   * @param trainGames Optional train games for profile building.
   */
  baseline(testGames: LichessGame[], trainGames?: LichessGame[]): Promise<TestResult>;
  compare(a: TestResult, b: TestResult): ComparisonTable;
}

export function createEvalOps(sandbox: SandboxInfo): EvalOps {
  return {
    async run(
      testGames: LichessGame[],
      opts: EvalOptions = {}
    ): Promise<TestResult> {
      const {
        seed = 42,
        label = "forge-eval",
        maxPositions,
        skipTopN = false,
        phaseBalanced = true,
        timeoutMs = 5 * 60 * 1000, // 5 minutes default
        trainGames,
      } = opts;

      const dataset = buildDataset(testGames, label);
      const input: EvalWorkerInput = {
        dataset,
        runConfig: {
          seed,
          label,
          maxPositions,
          skipTopN,
          phaseBalanced,
        },
        trainGames,
      };

      const result = await runWorker(sandbox, input, timeoutMs);

      // Guard: reject evaluations that produced 0 positions.
      // This happens when player games lack Stockfish analysis (game.analysis is empty).
      if (result.metrics.totalPositions === 0) {
        throw new Error(
          'Evaluation produced 0 positions. The player games likely lack Stockfish analysis (game.analysis is empty). ' +
          'Import games with evaluations or use forge.tools.evalPlayer(username) to pre-compute evaluations.'
        );
      }

      return result;
    },

    async runQuick(
      testGames: LichessGame[],
      trainGames?: LichessGame[],
      n: number = 50
    ): Promise<TestResult> {
      return this.run(testGames, {
        label: "forge-triage",
        maxPositions: n,
        skipTopN: true,
        phaseBalanced: true,
        timeoutMs: 3 * 60 * 1000, // 3 minutes for quick runs
        trainGames,
      });
    },

    async baseline(
      testGames: LichessGame[],
      trainGames?: LichessGame[]
    ): Promise<TestResult> {
      // Baseline runs without any config overrides, using the
      // sandbox's current engine code. For a true baseline, the
      // caller should ensure no code changes are applied yet.
      return this.run(testGames, {
        label: "baseline",
        phaseBalanced: true,
        timeoutMs: 10 * 60 * 1000, // 10 minutes for baseline
        trainGames,
      });
    },

    compare(a: TestResult, b: TestResult): ComparisonTable {
      const rows: ComparisonRow[] = [];

      function addRow(
        metric: string,
        valA: number,
        valB: number,
        higherIsBetter: boolean
      ): void {
        // Skip rows where both values are missing (null/NaN from JSON round-trip)
        const aMissing = valA == null || isNaN(valA);
        const bMissing = valB == null || isNaN(valB);
        if (aMissing && bMissing) return;

        const safeA = aMissing ? NaN : valA;
        const safeB = bMissing ? NaN : valB;
        const delta = safeB - safeA;
        const deltaPercent =
          !isNaN(delta) && safeA !== 0
            ? (delta / Math.abs(safeA)) * 100
            : !isNaN(delta) && delta !== 0
              ? Infinity
              : 0;
        rows.push({
          metric,
          baseline: safeA,
          experiment: safeB,
          delta: isNaN(delta) ? NaN : delta,
          deltaPercent: isNaN(deltaPercent) ? NaN : deltaPercent,
          improved: isNaN(delta) ? false : higherIsBetter ? delta > 0 : delta < 0,
        });
      }

      const mA = a.metrics;
      const mB = b.metrics;

      addRow("Match Rate", mA.matchRate, mB.matchRate, true);
      addRow("Top-N Rate", mA.topNRate, mB.topNRate, true);
      addRow("Book Coverage", mA.bookCoverage, mB.bookCoverage, true);
      addRow("Avg Player CPL", mA.avgActualCPL, mB.avgActualCPL, false);
      addRow("Avg Bot CPL", mA.avgBotCPL, mB.avgBotCPL, false);
      addRow("CPL Delta", mA.cplDelta, mB.cplDelta, false);

      // Phase-level metrics
      for (const phase of ["opening", "middlegame", "endgame"] as const) {
        const pA = mA.byPhase[phase];
        const pB = mB.byPhase[phase];
        if (pA && pB) {
          addRow(
            `${phase} Match Rate`,
            pA.matchRate,
            pB.matchRate,
            true
          );
          addRow(
            `${phase} Bot CPL`,
            pA.botAvgCPL,
            pB.botAvgCPL,
            false
          );
        }
      }

      // Build summary
      const improved = rows.filter((r) => r.improved);
      const regressed = rows.filter(
        (r) => !r.improved && Math.abs(r.delta) > 1e-6
      );
      const summary = [
        `Comparing "${a.label}" vs "${b.label}"`,
        `Positions: ${a.metrics.totalPositions} vs ${b.metrics.totalPositions}`,
        `Improved: ${improved.length} metrics`,
        `Regressed: ${regressed.length} metrics`,
        "",
        formatTable(rows),
      ].join("\n");

      return { rows, summary };
    },
  };
}

/* ── Table formatting ──────────────────────────────────────── */

function formatTable(rows: ComparisonRow[]): string {
  const header = "Metric                    | Baseline | Experiment |   Delta  |    %    | Result";
  const sep = "-".repeat(header.length);

  const lines = rows.map((r) => {
    const metric = r.metric.padEnd(25);
    const base = formatNum(r.baseline).padStart(8);
    const exp = formatNum(r.experiment).padStart(10);
    const delta = formatDelta(r.delta).padStart(8);
    const pct = formatPct(r.deltaPercent).padStart(7);
    const icon = r.improved ? "  +" : Math.abs(r.delta) < 1e-6 ? "  =" : "  -";
    return `${metric} | ${base} | ${exp} | ${delta} | ${pct} | ${icon}`;
  });

  return [header, sep, ...lines].join("\n");
}

function formatNum(n: number): string {
  if (isNaN(n)) return "N/A";
  if (Math.abs(n) < 1) return (n * 100).toFixed(1) + "%";
  return n.toFixed(1);
}

function formatDelta(n: number): string {
  if (isNaN(n)) return "N/A";
  const sign = n > 0 ? "+" : "";
  if (Math.abs(n) < 1) return sign + (n * 100).toFixed(1) + "%";
  return sign + n.toFixed(1);
}

function formatPct(n: number): string {
  if (!isFinite(n)) return "N/A";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(1) + "%";
}

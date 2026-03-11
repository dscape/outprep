/**
 * Pre-computed game evaluations queue service.
 *
 * Background service that polls the `tool_jobs` table for pending
 * `eval_player` jobs and processes them by running Stockfish analysis
 * on player games. Results are stored in the `player_evaluations` table.
 *
 * This solves the 0-position error: agents no longer encounter missing
 * evaluations at experiment time because games are pre-evaluated here.
 *
 * Usage:
 *   - Submit a job:    submitEvalJob("username")
 *   - Start service:   startEvalService()    (runs forever, polls every 10s)
 *   - Check status:    getEvalJobStatus(jobId)
 *   - Check player:    isPlayerEvaluated("username")
 */

import { getForgeDb } from "../state/forge-db";
import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { NodeStockfishAdapter } from "@outprep/harness";
import type { LichessGame } from "@outprep/harness";

/* ── Types ─────────────────────────────────────────────────── */

interface EvalJob {
  id: string;
  session_id: string;
  agent_id: string | null;
  tool_name: string;
  status: string;
  input: string;
  created_at: string;
}

interface ChessPosition {
  fen: string;
  moveNumber: number;
  phase: "opening" | "middlegame" | "endgame";
}

interface EvalResult extends ChessPosition {
  evalScore: number; // centipawns from white's perspective
  bestMove: string; // UCI notation
  depth: number;
}

/* ── Phase detection (lightweight, no engine dependency) ──── */

/**
 * Count non-pawn, non-king pieces on the board.
 * Starting position has 14 (2Q + 4R + 4B + 4N).
 */
function countPieces(fen: string): number {
  const boardPart = fen.split(" ")[0];
  let count = 0;
  for (const ch of boardPart) {
    if ("rnbqRNBQ".includes(ch)) count++;
  }
  return count;
}

/**
 * Determine game phase from piece count.
 * Uses the same thresholds as the engine's phase detector:
 *   opening:    pieces > 10
 *   endgame:    pieces <= 6
 *   middlegame: everything else
 */
function detectPhase(fen: string): "opening" | "middlegame" | "endgame" {
  const pieces = countPieces(fen);
  if (pieces > 10) return "opening";
  if (pieces <= 6) return "endgame";
  return "middlegame";
}

/* ── Position extraction ─────────────────────────────────── */

/**
 * Extract all positions from a game where the target player has to move.
 * Returns FENs with move numbers and phases.
 *
 * The game_data in the database is a serialized LichessGame. We replay
 * the move sequence using chess.js and record every position where the
 * player is on move.
 */
function extractPositionsFromGame(game: LichessGame, username: string): ChessPosition[] {
  if (!game.moves || game.variant !== "standard") return [];

  const isWhite =
    game.players.white?.user?.id?.toLowerCase() === username.toLowerCase() ||
    game.players.white?.user?.name?.toLowerCase() === username.toLowerCase();

  const chess = new Chess();
  const moves = game.moves.split(" ");
  const positions: ChessPosition[] = [];

  for (let ply = 0; ply < moves.length; ply++) {
    const isWhiteMove = ply % 2 === 0;
    const isPlayerMove = (isWhite && isWhiteMove) || (!isWhite && !isWhiteMove);

    if (isPlayerMove) {
      const fen = chess.fen();
      const moveNumber = Math.floor(ply / 2) + 1;
      positions.push({
        fen,
        moveNumber,
        phase: detectPhase(fen),
      });
    }

    try {
      chess.move(moves[ply]);
    } catch {
      // Invalid move — stop processing this game
      break;
    }
  }

  return positions;
}

/* ── Stockfish evaluation ────────────────────────────────── */

/**
 * Evaluate a batch of positions using Stockfish at the specified depth.
 * Initializes a single Stockfish instance, evaluates all positions
 * sequentially, then disposes the engine.
 */
async function evaluatePositions(positions: ChessPosition[], depth: number = 18): Promise<EvalResult[]> {
  if (positions.length === 0) return [];

  const engine = new NodeStockfishAdapter();
  await engine.init();

  const results: EvalResult[] = [];

  try {
    for (const pos of positions) {
      try {
        const candidate = await engine.evaluate(pos.fen, depth);
        results.push({
          ...pos,
          evalScore: candidate.score,
          bestMove: candidate.uci,
          depth: candidate.depth,
        });
      } catch (err) {
        // Skip positions that Stockfish can't evaluate (e.g., already checkmate)
        // but continue with the rest
        console.warn(`    Warning: could not evaluate position: ${(err as Error).message}`);
      }
    }
  } finally {
    engine.dispose();
  }

  return results;
}

/* ── Job processing ──────────────────────────────────────── */

/**
 * Process a single eval job: load the player's unevaluated games,
 * extract positions, run Stockfish, and store results.
 */
async function processEvalJob(job: EvalJob): Promise<void> {
  const db = getForgeDb();
  const input = JSON.parse(job.input) as { username: string };
  const { username } = input;

  console.log(`  Processing eval job ${job.id.slice(0, 8)} for "${username}"...`);

  // Mark as running
  db.prepare(`UPDATE tool_jobs SET status = 'running', started_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), job.id);

  try {
    // Load unevaluated games for this player
    const games = db.prepare(
      `SELECT game_id, game_data FROM player_games WHERE username = ? AND has_eval = 0`
    ).all(username) as { game_id: string; game_data: string }[];

    if (games.length === 0) {
      // All games already evaluated or no games exist
      const total = db.prepare(
        `SELECT COUNT(*) as cnt FROM player_games WHERE username = ?`
      ).get(username) as { cnt: number };

      db.prepare(`UPDATE tool_jobs SET status = 'completed', completed_at = ?, output = ? WHERE id = ?`)
        .run(
          new Date().toISOString(),
          JSON.stringify({
            positionsEvaluated: 0,
            gamesProcessed: 0,
            totalGames: total.cnt,
            message: "All games already evaluated",
          }),
          job.id
        );
      console.log(`  > Job ${job.id.slice(0, 8)}: All ${total.cnt} games already evaluated`);
      return;
    }

    let totalPositions = 0;
    let gamesProcessed = 0;

    // Prepare statements for batch inserts
    const insertEval = db.prepare(`
      INSERT OR IGNORE INTO player_evaluations (username, game_id, fen, move_number, phase, eval_score, best_move, depth)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const markEvaled = db.prepare(
      `UPDATE player_games SET has_eval = 1 WHERE username = ? AND game_id = ?`
    );

    for (const row of games) {
      try {
        const game = JSON.parse(row.game_data) as LichessGame;
        const positions = extractPositionsFromGame(game, username);

        if (positions.length > 0) {
          // Evaluate with Stockfish
          const evaluations = await evaluatePositions(positions);

          // Store evaluations in a transaction
          const insertMany = db.transaction(() => {
            for (const evalResult of evaluations) {
              insertEval.run(
                username,
                row.game_id,
                evalResult.fen,
                evalResult.moveNumber,
                evalResult.phase,
                evalResult.evalScore,
                evalResult.bestMove,
                evalResult.depth
              );
            }
            markEvaled.run(username, row.game_id);
          });
          insertMany();

          totalPositions += evaluations.length;
        } else {
          // No positions extractable — still mark to avoid re-processing
          markEvaled.run(username, row.game_id);
        }

        gamesProcessed++;
        if (gamesProcessed % 10 === 0) {
          console.log(`    ... ${gamesProcessed}/${games.length} games, ${totalPositions} positions`);
        }
      } catch (err) {
        console.warn(`    Warning: error processing game ${row.game_id}: ${(err as Error).message}`);
      }
    }

    // Mark job as completed
    db.prepare(`UPDATE tool_jobs SET status = 'completed', completed_at = ?, output = ? WHERE id = ?`)
      .run(
        new Date().toISOString(),
        JSON.stringify({
          positionsEvaluated: totalPositions,
          gamesProcessed,
          totalGames: games.length,
        }),
        job.id
      );

    console.log(`  > Job ${job.id.slice(0, 8)}: ${gamesProcessed} games, ${totalPositions} positions evaluated`);
  } catch (err) {
    db.prepare(`UPDATE tool_jobs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`)
      .run(new Date().toISOString(), (err as Error).message, job.id);
    console.error(`  > Job ${job.id.slice(0, 8)} failed: ${(err as Error).message}`);
  }
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Start the eval service -- polls for pending eval_player jobs and processes them.
 * Runs indefinitely until the process is killed.
 */
export async function startEvalService(): Promise<void> {
  console.log("  Eval service started. Polling for jobs...\n");

  while (true) {
    try {
      const db = getForgeDb();

      // Find next pending eval job (oldest first)
      const job = db.prepare(
        `SELECT * FROM tool_jobs WHERE tool_name = 'eval_player' AND status = 'pending' ORDER BY created_at ASC LIMIT 1`
      ).get() as EvalJob | undefined;

      if (job) {
        await processEvalJob(job);
      }
    } catch (err) {
      console.error(`  Eval service error: ${(err as Error).message}`);
    }

    // Sleep 10 seconds between polls
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

/**
 * Submit an eval job for a player. Returns the job ID.
 */
export function submitEvalJob(
  username: string,
  sessionId: string = "system",
  agentId?: string
): string {
  const db = getForgeDb();
  const jobId = randomUUID();

  db.prepare(`
    INSERT INTO tool_jobs (id, session_id, agent_id, tool_name, status, input, created_at, blocking)
    VALUES (?, ?, ?, 'eval_player', 'pending', ?, ?, 1)
  `).run(
    jobId,
    sessionId,
    agentId ?? null,
    JSON.stringify({ username }),
    new Date().toISOString()
  );

  console.log(`  Submitted eval job ${jobId.slice(0, 8)} for player "${username}"`);
  return jobId;
}

/**
 * Check if a player has been fully evaluated (all games have has_eval = 1).
 */
export function isPlayerEvaluated(username: string): boolean {
  const db = getForgeDb();
  const gameCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM player_games WHERE username = ?`
  ).get(username) as { cnt: number };

  if (gameCount.cnt === 0) return false;

  const evaledCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM player_games WHERE username = ? AND has_eval = 1`
  ).get(username) as { cnt: number };

  return evaledCount.cnt >= gameCount.cnt;
}

/**
 * Get eval job status by job ID.
 */
export function getEvalJobStatus(
  jobId: string
): { status: string; output?: any; error?: string } | null {
  const db = getForgeDb();
  const job = db.prepare(
    `SELECT status, output, error FROM tool_jobs WHERE id = ?`
  ).get(jobId) as { status: string; output: string | null; error: string | null } | undefined;

  if (!job) return null;

  return {
    status: job.status,
    output: job.output ? JSON.parse(job.output) : undefined,
    error: job.error ?? undefined,
  };
}

/**
 * List all eval jobs with optional status filter.
 */
export function listEvalJobs(status?: string): any[] {
  const db = getForgeDb();
  if (status) {
    return db.prepare(
      `SELECT * FROM tool_jobs WHERE tool_name = 'eval_player' AND status = ? ORDER BY created_at DESC`
    ).all(status) as any[];
  }
  return db.prepare(
    `SELECT * FROM tool_jobs WHERE tool_name = 'eval_player' ORDER BY created_at DESC`
  ).all() as any[];
}

/**
 * Submit eval jobs for all players that have unevaluated games.
 * Returns the list of job IDs submitted.
 */
export function submitEvalJobsForAll(sessionId: string = "system"): string[] {
  const db = getForgeDb();

  // Find players with unevaluated games
  const players = db.prepare(`
    SELECT DISTINCT pg.username
    FROM player_games pg
    WHERE pg.has_eval = 0
      AND NOT EXISTS (
        SELECT 1 FROM tool_jobs tj
        WHERE tj.tool_name = 'eval_player'
          AND tj.status IN ('pending', 'running')
          AND json_extract(tj.input, '$.username') = pg.username
      )
  `).all() as { username: string }[];

  if (players.length === 0) {
    console.log("  No unevaluated players found.");
    return [];
  }

  const jobIds: string[] = [];
  for (const { username } of players) {
    const jobId = submitEvalJob(username, sessionId);
    jobIds.push(jobId);
  }

  return jobIds;
}

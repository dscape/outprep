"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Chessboard } from "react-chessboard";
import { Chess, Square } from "chess.js";
import { StockfishEngine } from "@/lib/stockfish-worker";
import { WasmStockfishAdapter } from "@/lib/stockfish-adapter";
import type { ErrorProfile, OpeningTrie, BotMoveResult, StyleMetrics, CandidateMove } from "@outprep/engine";
import { BotController, createBot, temperatureFromSkill } from "@outprep/engine";
import { LiveGameAnalyzer } from "@/lib/engine/live-analyzer";
import { useDebugPanel } from "@/hooks/useDebugPanel";
import { buildDebugEntry, type DebugMoveEntry } from "@/lib/debug-reasoning";
import DebugPanel from "@/components/DebugPanel";

interface ChessBoardProps {
  playerColor: "white" | "black";
  opponentUsername: string;
  fideEstimate: number;
  errorProfile: ErrorProfile | null;
  openingTrie: OpeningTrie | null;
  onGameEnd: (pgn: string, result: string, precomputedAnalysis?: {
    moves: import("@/lib/types").MoveEval[];
    summary: import("@/lib/types").AnalysisSummary;
  }) => void;
  startingMoves?: string[];
  botDataLabel?: string;
  styleMetrics?: StyleMetrics | null;
}

export default function ChessBoard({
  playerColor,
  opponentUsername,
  fideEstimate,
  errorProfile,
  openingTrie,
  onGameEnd,
  startingMoves,
  botDataLabel,
  styleMetrics,
}: ChessBoardProps) {
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(gameRef.current.fen());
  const [moveSource, setMoveSource] = useState<"book" | "engine" | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [lastMoveInfo, setLastMoveInfo] = useState<{
    phase: string;
    skill: number;
  } | null>(null);
  const [legalMoveSquares, setLegalMoveSquares] = useState<Record<string, React.CSSProperties>>({});
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [finalizingAnalysis, setFinalizingAnalysis] = useState(false);
  const [finalizingProgress, setFinalizingProgress] = useState<{
    evaluated: number;
    total: number;
  } | null>(null);
  const [debugHistory, setDebugHistory] = useState<DebugMoveEntry[]>([]);
  const [boardArrows, setBoardArrows] = useState<
    { startSquare: string; endSquare: string; color: string }[]
  >([]);
  const { isOpen: debugOpen, toggle: toggleDebug, close: closeDebug } = useDebugPanel();
  const engineRef = useRef<StockfishEngine | null>(null);
  const botRef = useRef<BotController | null>(null);
  const analyzerRef = useRef<LiveGameAnalyzer | null>(null);
  const gameEndedRef = useRef(false);
  const plyRef = useRef(0);
  const lastPlayerMoveSanRef = useRef<string | null>(null);

  const botColor = playerColor === "white" ? "black" : "white";

  const checkGameEnd = useCallback(
    async (chess: Chess) => {
      if (gameEndedRef.current) return;

      if (chess.isGameOver()) {
        gameEndedRef.current = true;
        let result = "1/2-1/2";
        if (chess.isCheckmate()) {
          result = chess.turn() === "w" ? "0-1" : "1-0";
        }

        // Wait for live analyzer to finish, then build pre-computed analysis
        const analyzer = analyzerRef.current;
        let precomputed: {
          moves: import("@/lib/types").MoveEval[];
          summary: import("@/lib/types").AnalysisSummary;
        } | undefined;

        if (analyzer) {
          const totalPlies = chess.history().length;
          if (!analyzer.isComplete(totalPlies)) {
            setFinalizingAnalysis(true);
            await analyzer.waitForCompletion(
              totalPlies,
              30000,
              (evaluated, total) => {
                setFinalizingProgress({ evaluated, total });
              },
            );
            setFinalizingAnalysis(false);
            setFinalizingProgress(null);
          }
          const analysis = analyzer.buildAnalysis(chess.history(), playerColor);
          if (analysis) {
            precomputed = analysis;
          }
        }

        onGameEnd(chess.pgn(), result, precomputed);
      }
    },
    [onGameEnd, playerColor],
  );

  // Initialize Stockfish engine + BotController + LiveGameAnalyzer
  useEffect(() => {
    const engine = new StockfishEngine();
    engineRef.current = engine;

    // Initialize live analyzer in parallel
    const analyzer = new LiveGameAnalyzer();
    analyzerRef.current = analyzer;

    Promise.all([
      engine.init(),
      analyzer.init(),
    ])
      .then(() => {
        // Record starting position (ply 0) — always needed for analysis
        analyzer.recordPosition(0, gameRef.current.fen());

        // Pre-play opening moves if starting from a specific position
        if (startingMoves && startingMoves.length > 0) {
          const game = gameRef.current;
          for (const uci of startingMoves) {
            try {
              const from = uci.substring(0, 2) as Square;
              const to = uci.substring(2, 4) as Square;
              const promotion =
                uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined;
              const move = game.move({ from, to, promotion });
              if (move) {
                plyRef.current++;
                analyzer.recordPosition(plyRef.current, game.fen());
              } else {
                break; // Invalid move — stop pre-playing
              }
            } catch {
              break;
            }
          }
          setFen(game.fen());
        }

        const adapter = new WasmStockfishAdapter(engine);
        const bot = createBot(adapter, {
          elo: fideEstimate,
          errorProfile,
          openingTrie,
          botColor,
          styleMetrics,
        });
        botRef.current = bot;
        setEngineReady(true);
      })
      .catch((err) => {
        console.error("Failed to init engines:", err);
        // Still try to use bot engine even if analyzer fails
        engine.init().then(() => {
          const adapter = new WasmStockfishAdapter(engine);
          const bot = createBot(adapter, {
            elo: fideEstimate,
            errorProfile,
            openingTrie,
            botColor,
            styleMetrics,
          });
          botRef.current = bot;
          setEngineReady(true);
        }).catch(() => {});
      });

    return () => {
      engine.quit();
      analyzer.quit();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Debug arrows: show candidate moves on the board ──────── */

  function buildCandidateArrows(
    candidates: CandidateMove[],
    dynamicSkill: number,
  ): { startSquare: string; endSquare: string; color: string }[] {
    if (candidates.length === 0) return [];

    // Boltzmann probabilities (same softmax as move-selector.ts)
    const temperature = temperatureFromSkill(dynamicSkill);
    const maxScore = Math.max(...candidates.map((c) => c.score));
    const weights = candidates.map((c) =>
      Math.exp((c.score - maxScore) / temperature)
    );
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const probs = weights.map((w) => w / totalWeight);

    // Scale probabilities to visible opacity range [0.3, 1.0]
    // react-chessboard applies its own 0.65 opacity multiplier on arrows
    const maxProb = Math.max(...probs);
    return candidates.map((c, i) => {
      const from = c.uci.substring(0, 2);
      const to = c.uci.substring(2, 4);
      const normalizedProb = maxProb > 0 ? probs[i] / maxProb : 0.5;
      const opacity = 0.3 + normalizedProb * 0.7; // range [0.3, 1.0]

      // Green (best) → yellow (2nd) → orange (rest)
      const color =
        i === 0
          ? `rgba(0, 200, 0, ${opacity.toFixed(2)})`
          : i === 1
            ? `rgba(255, 200, 0, ${opacity.toFixed(2)})`
            : `rgba(255, 120, 0, ${opacity.toFixed(2)})`;

      return { startSquare: from, endSquare: to, color };
    });
  }

  function buildSelectedArrow(
    uci: string,
  ): { startSquare: string; endSquare: string; color: string }[] {
    return [
      {
        startSquare: uci.substring(0, 2),
        endSquare: uci.substring(2, 4),
        color: "rgba(0, 120, 255, 0.85)",
      },
    ];
  }

  // Bot move using BotController
  const makeBotMove = useCallback(async () => {
    const game = gameRef.current;
    if (gameEndedRef.current) return;
    if (game.isGameOver()) return;

    const isPlayerTurn =
      (playerColor === "white" && game.turn() === "w") ||
      (playerColor === "black" && game.turn() === "b");

    if (isPlayerTurn) return;

    const bot = botRef.current;
    if (!bot) return;

    setThinking(true);

    try {
      const fenBeforeMove = game.fen(); // Capture FEN before bot moves
      const result: BotMoveResult = await bot.getMove(fenBeforeMove);
      if (gameEndedRef.current) return;

      // Validate UCI before proceeding
      if (!result.uci || result.uci.length < 4) {
        console.error("Invalid UCI from bot:", result.uci);
        return;
      }

      // Arrow preview when debug panel is open + engine move with candidates
      const showArrows =
        debugOpen &&
        result.source === "engine" &&
        result.candidates &&
        result.candidates.length > 1;

      if (showArrows) {
        // Phase 1: Show all candidate arrows (replaces think time delay)
        setBoardArrows(
          buildCandidateArrows(result.candidates!, result.dynamicSkill)
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(1200, result.thinkTimeMs))
        );
        if (gameEndedRef.current) return;

        // Phase 2: Highlight just the selected move
        setBoardArrows(buildSelectedArrow(result.uci));
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (gameEndedRef.current) return;

        // Phase 3: Clear arrows before playing the move
        setBoardArrows([]);
      } else {
        // Normal flow: just apply think time delay
        await new Promise((resolve) =>
          setTimeout(resolve, result.thinkTimeMs)
        );
        if (gameEndedRef.current) return;
      }

      // Apply the move
      const from = result.uci.substring(0, 2) as Square;
      const to = result.uci.substring(2, 4) as Square;
      const promotion =
        result.uci.length > 4
          ? (result.uci[4] as "q" | "r" | "b" | "n")
          : undefined;

      const move = game.move({ from, to, promotion });
      if (move) {
        plyRef.current++;
        setFen(game.fen());
        setMoveSource(result.source);
        setLastMoveInfo({ phase: result.phase, skill: result.dynamicSkill });

        // Record position for live analysis
        analyzerRef.current?.recordPosition(plyRef.current, game.fen());

        // Debug: accumulate full bot reasoning with Stockfish comparison
        // evalBefore = position before bot moved (ply N-1), evalAfter = position after (ply N)
        const evalBefore = analyzerRef.current?.getPositionEval(plyRef.current - 1) ?? null;
        const evalAfter = analyzerRef.current?.getPositionEval(plyRef.current) ?? null;
        const entry = buildDebugEntry(plyRef.current, result, fenBeforeMove, evalBefore, evalAfter, lastPlayerMoveSanRef.current);
        lastPlayerMoveSanRef.current = null; // Reset after use
        setDebugHistory(prev => [...prev, entry]);

        checkGameEnd(game);
      }
    } catch (err) {
      console.error("Bot move error:", err);
    } finally {
      setThinking(false);
      setBoardArrows([]); // Safety: always clear arrows when done
    }
  }, [playerColor, checkGameEnd, debugOpen]);

  // Trigger bot move when it's their turn
  useEffect(() => {
    if (!engineReady) return;

    const game = gameRef.current;
    const isPlayerTurn =
      (playerColor === "white" && game.turn() === "w") ||
      (playerColor === "black" && game.turn() === "b");

    if (!isPlayerTurn && !game.isGameOver()) {
      // Small initial delay so the board renders first
      const timeout = setTimeout(makeBotMove, 100);
      return () => clearTimeout(timeout);
    }
  }, [fen, playerColor, engineReady, makeBotMove]);

  // Lazy-update: back-fill Stockfish data on debug entries when LiveAnalyzer catches up
  useEffect(() => {
    if (!debugOpen || !analyzerRef.current) return;
    const interval = setInterval(() => {
      setDebugHistory((prev) => {
        let changed = false;
        const updated = prev.map((entry) => {
          // Skip entries that already have Stockfish data
          if (entry.stockfishEval !== null) return entry;
          const evalBefore =
            analyzerRef.current?.getPositionEval(entry.ply - 1) ?? null;
          const evalAfter =
            analyzerRef.current?.getPositionEval(entry.ply) ?? null;
          if (!evalBefore) return entry; // Not ready yet
          changed = true;
          return buildDebugEntry(
            entry.ply,
            entry.result,
            entry.fen,
            evalBefore,
            evalAfter,
            entry.playerMoveSan
          );
        });
        return changed ? updated : prev;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [debugOpen]);

  // ── Shared helper: highlight legal moves for a given square ──

  function showLegalMoves(square: Square): boolean {
    const game = gameRef.current;
    const moves = game.moves({ square, verbose: true });

    const styles: Record<string, React.CSSProperties> = {};

    // Highlight source square
    styles[square as string] = { backgroundColor: "rgba(255, 255, 0, 0.4)" };

    for (const move of moves) {
      if (move.captured) {
        // Capture: ring around the edge
        styles[move.to] = {
          background: "radial-gradient(transparent 0%, transparent 79%, rgba(0,0,0,0.3) 80%)",
          borderRadius: "50%",
        };
      } else {
        // Empty: centered dot
        styles[move.to] = {
          background: "radial-gradient(rgba(0,0,0,0.25) 25%, transparent 25%)",
          borderRadius: "50%",
        };
      }
    }

    setLegalMoveSquares(styles);
    return moves.length > 0;
  }

  function isPlayerTurnNow(): boolean {
    return (
      (playerColor === "white" && gameRef.current.turn() === "w") ||
      (playerColor === "black" && gameRef.current.turn() === "b")
    );
  }

  // ── Drag-and-drop handlers ──

  function onPieceDrag({ square }: { piece: unknown; square: string | null }) {
    if (gameEndedRef.current || !square) return;
    if (!isPlayerTurnNow()) return;

    setSelectedSquare(null); // Clear click-selection when dragging starts
    showLegalMoves(square as Square);
  }

  function onDrop({
    sourceSquare,
    targetSquare,
  }: {
    piece: unknown;
    sourceSquare: string;
    targetSquare: string | null;
  }): boolean {
    // Clear legal move highlights and click-selection
    setLegalMoveSquares({});
    setSelectedSquare(null);

    const game = gameRef.current;
    if (gameEndedRef.current) return false;
    if (!targetSquare) return false;
    if (!isPlayerTurnNow()) return false;

    try {
      const move = game.move({
        from: sourceSquare as Square,
        to: targetSquare as Square,
        promotion: "q",
      });

      if (!move) return false;

      lastPlayerMoveSanRef.current = move.san;
      plyRef.current++;
      setFen(game.fen());

      // Record position for live analysis
      analyzerRef.current?.recordPosition(plyRef.current, game.fen());

      checkGameEnd(game);
      return true;
    } catch {
      return false;
    }
  }

  // ── Click-to-move: select piece then click destination ──

  function onSquareClick({ square }: { piece: unknown; square: string }) {
    const game = gameRef.current;
    if (gameEndedRef.current) return;
    if (!isPlayerTurnNow()) return;

    const sq = square as Square;
    const playerColorChar = playerColor === "white" ? "w" : "b";

    // If a piece is already selected, try to move there
    if (selectedSquare) {
      try {
        const move = game.move({
          from: selectedSquare,
          to: sq,
          promotion: "q",
        });

        if (move) {
          lastPlayerMoveSanRef.current = move.san;
          plyRef.current++;
          setFen(game.fen());
          setSelectedSquare(null);
          setLegalMoveSquares({});

          // Record position for live analysis
          analyzerRef.current?.recordPosition(plyRef.current, game.fen());

          checkGameEnd(game);
          return;
        }
      } catch {
        // Not a valid move — fall through to reselect
      }
    }

    // Select or reselect: check if clicked square has a player piece
    const piece = game.get(sq);
    if (piece && piece.color === playerColorChar) {
      setSelectedSquare(sq);
      showLegalMoves(sq);
    } else {
      setSelectedSquare(null);
      setLegalMoveSquares({});
    }
  }

  async function handleResign() {
    if (gameEndedRef.current) return;
    gameEndedRef.current = true;

    const game = gameRef.current;
    const result = playerColor === "white" ? "0-1" : "1-0";

    // Wait for live analyzer to finish, then build pre-computed analysis
    const analyzer = analyzerRef.current;
    let precomputed: {
      moves: import("@/lib/types").MoveEval[];
      summary: import("@/lib/types").AnalysisSummary;
    } | undefined;

    if (analyzer) {
      const totalPlies = game.history().length;
      if (!analyzer.isComplete(totalPlies)) {
        setFinalizingAnalysis(true);
        await analyzer.waitForCompletion(
          totalPlies,
          30000,
          (evaluated, total) => {
            setFinalizingProgress({ evaluated, total });
          },
        );
        setFinalizingAnalysis(false);
        setFinalizingProgress(null);
      }
      const history = game.history();
      const analysis = analyzer.buildAnalysis(history, playerColor);
      if (analysis) {
        precomputed = analysis;
      }
    }

    onGameEnd(game.pgn(), result, precomputed);
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {debugOpen && (
        <DebugPanel
          entries={debugHistory}
          onClose={closeDebug}
          errorProfile={errorProfile}
          styleMetrics={styleMetrics}
        />
      )}
      {/* Status bar */}
      <div className="flex items-center gap-3 text-sm flex-wrap justify-center">
        {moveSource === "book" && (
          <span className="rounded-full bg-green-600/20 border border-green-500/30 px-3 py-1 text-green-400">
            Following {opponentUsername}&apos;s repertoire
          </span>
        )}
        {moveSource === "engine" && (
          <span className="rounded-full bg-zinc-700/50 border border-zinc-600/30 px-3 py-1 text-zinc-400">
            Out of book
          </span>
        )}
        {thinking && (
          <span className="flex items-center gap-1.5 text-zinc-400">
            <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
            Thinking...
          </span>
        )}
        {!engineReady && (
          <span className="text-zinc-500">Loading engine...</span>
        )}
      </div>

      {/* Board */}
      <div className="w-full max-w-[min(90vw,560px)] aspect-square relative">
        <Chessboard
          options={{
            position: fen,
            onPieceDrop: onDrop,
            onPieceDrag: onPieceDrag,
            onSquareClick: onSquareClick,
            boardOrientation: playerColor,
            squareStyles: legalMoveSquares,
            arrows: boardArrows,
            boardStyle: {
              borderRadius: "8px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            },
            darkSquareStyle: { backgroundColor: "#779952" },
            lightSquareStyle: { backgroundColor: "#edeed1" },
          }}
        />
        {finalizingAnalysis && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
            <div className="flex flex-col items-center gap-2 text-white text-sm">
              <div className="h-4 w-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
              Finalizing analysis...
              {finalizingProgress && (
                <span className="text-xs text-zinc-400">
                  {finalizingProgress.evaluated}/{finalizingProgress.total} positions
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Game info */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-4">
          <div className="text-sm text-zinc-400">
            ~{fideEstimate} FIDE
            {lastMoveInfo && (
              <span className="ml-2 text-zinc-600">
                {lastMoveInfo.phase} / skill {lastMoveInfo.skill}
              </span>
            )}
          </div>
          <button
            onClick={toggleDebug}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors flex items-center gap-1.5 ${
              debugOpen
                ? "bg-purple-600/20 border-purple-500/30 text-purple-400"
                : "bg-zinc-700/30 border-zinc-600/30 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-700/50"
            }`}
            title="Show bot thinking"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
              <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
              <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
              <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
              <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
              <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
              <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
              <path d="M6 18a4 4 0 0 1-1.967-.516" />
              <path d="M19.967 17.484A4 4 0 0 1 18 18" />
            </svg>
            Thinking
          </button>
          <button
            onClick={handleResign}
            className="rounded-md bg-red-600/20 border border-red-500/30 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-600/30"
          >
            Resign
          </button>
        </div>
        {botDataLabel && (
          <span className="text-xs text-zinc-600">{botDataLabel}</span>
        )}
      </div>
    </div>
  );
}

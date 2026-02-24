"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Chessboard } from "react-chessboard";
import { Chess, Square } from "chess.js";
import { StockfishEngine } from "@/lib/stockfish-worker";
import { ErrorProfile } from "@/lib/types";
import { OpeningTrie } from "@/lib/engine/opening-trie";
import { BotController, BotMoveResult } from "@/lib/engine/bot-controller";

interface ChessBoardProps {
  playerColor: "white" | "black";
  opponentUsername: string;
  fideEstimate: number;
  errorProfile: ErrorProfile | null;
  openingTrie: OpeningTrie | null;
  onGameEnd: (pgn: string, result: string) => void;
}

export default function ChessBoard({
  playerColor,
  opponentUsername,
  fideEstimate,
  errorProfile,
  openingTrie,
  onGameEnd,
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
  const engineRef = useRef<StockfishEngine | null>(null);
  const botRef = useRef<BotController | null>(null);
  const gameEndedRef = useRef(false);

  const botColor = playerColor === "white" ? "black" : "white";

  const checkGameEnd = useCallback(
    (chess: Chess) => {
      if (gameEndedRef.current) return;

      if (chess.isGameOver()) {
        gameEndedRef.current = true;
        let result = "1/2-1/2";
        if (chess.isCheckmate()) {
          result = chess.turn() === "w" ? "0-1" : "1-0";
        }
        onGameEnd(chess.pgn(), result);
      }
    },
    [onGameEnd],
  );

  // Initialize Stockfish engine + BotController
  useEffect(() => {
    const engine = new StockfishEngine();
    engineRef.current = engine;

    engine
      .init()
      .then(() => {
        const bot = new BotController({
          engine,
          fideEstimate,
          errorProfile,
          openingTrie,
          botColor,
        });
        botRef.current = bot;
        setEngineReady(true);
      })
      .catch((err) => {
        console.error("Failed to init Stockfish:", err);
      });

    return () => {
      engine.quit();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      const result: BotMoveResult = await bot.getMove(game.fen());
      if (gameEndedRef.current) return;

      // Validate UCI before proceeding
      if (!result.uci || result.uci.length < 4) {
        console.error("Invalid UCI from bot:", result.uci);
        return;
      }

      // Apply think time delay
      await new Promise((resolve) => setTimeout(resolve, result.thinkTimeMs));
      if (gameEndedRef.current) return;

      // Apply the move
      const from = result.uci.substring(0, 2) as Square;
      const to = result.uci.substring(2, 4) as Square;
      const promotion =
        result.uci.length > 4
          ? (result.uci[4] as "q" | "r" | "b" | "n")
          : undefined;

      const move = game.move({ from, to, promotion });
      if (move) {
        setFen(game.fen());
        setMoveSource(result.source);
        setLastMoveInfo({ phase: result.phase, skill: result.dynamicSkill });
        checkGameEnd(game);
      }
    } catch (err) {
      console.error("Bot move error:", err);
    } finally {
      setThinking(false);
    }
  }, [playerColor, checkGameEnd]);

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

  function onDrop({
    sourceSquare,
    targetSquare,
  }: {
    piece: unknown;
    sourceSquare: string;
    targetSquare: string | null;
  }): boolean {
    const game = gameRef.current;
    if (gameEndedRef.current) return false;
    if (!targetSquare) return false;

    const isPlayerTurn =
      (playerColor === "white" && game.turn() === "w") ||
      (playerColor === "black" && game.turn() === "b");

    if (!isPlayerTurn) return false;

    try {
      const move = game.move({
        from: sourceSquare as Square,
        to: targetSquare as Square,
        promotion: "q",
      });

      if (!move) return false;

      setFen(game.fen());
      checkGameEnd(game);
      return true;
    } catch {
      return false;
    }
  }

  function handleResign() {
    if (gameEndedRef.current) return;
    gameEndedRef.current = true;
    const result = playerColor === "white" ? "0-1" : "1-0";
    onGameEnd(gameRef.current.pgn(), result);
  }

  return (
    <div className="flex flex-col items-center gap-4">
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
      <div className="w-full max-w-[min(90vw,560px)] aspect-square">
        <Chessboard
          options={{
            position: fen,
            onPieceDrop: onDrop,
            boardOrientation: playerColor,
            boardStyle: {
              borderRadius: "8px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            },
            darkSquareStyle: { backgroundColor: "#779952" },
            lightSquareStyle: { backgroundColor: "#edeed1" },
          }}
        />
      </div>

      {/* Game info */}
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
          onClick={handleResign}
          className="rounded-md bg-red-600/20 border border-red-500/30 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-600/30"
        >
          Resign
        </button>
      </div>
    </div>
  );
}

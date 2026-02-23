"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Chessboard } from "react-chessboard";
import { Chess, Square } from "chess.js";
import { StockfishEngine } from "@/lib/stockfish-worker";
import { lookupPosition } from "@/lib/opening-book";

interface ChessBoardProps {
  playerColor: "white" | "black";
  opponentUsername: string;
  openingBook: Uint8Array | null;
  fideEstimate: number;
  onGameEnd: (pgn: string, result: string) => void;
}

function getDepthForRating(fideEstimate: number): number {
  if (fideEstimate <= 1200) return 5;
  if (fideEstimate <= 1400) return 7;
  if (fideEstimate <= 1600) return 10;
  if (fideEstimate <= 1800) return 12;
  if (fideEstimate <= 2000) return 15;
  if (fideEstimate <= 2200) return 17;
  if (fideEstimate <= 2400) return 20;
  return 22;
}

export default function ChessBoard({
  playerColor,
  opponentUsername,
  openingBook,
  fideEstimate,
  onGameEnd,
}: ChessBoardProps) {
  // Use a ref for the Chess instance so move history is preserved across renders.
  // A separate FEN state triggers re-renders for the board display.
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(gameRef.current.fen());
  const [inBook, setInBook] = useState(true);
  const [engineReady, setEngineReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const engineRef = useRef<StockfishEngine | null>(null);
  const gameEndedRef = useRef(false);
  const depth = getDepthForRating(fideEstimate);

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

  // Initialize Stockfish engine
  useEffect(() => {
    const engine = new StockfishEngine();
    engineRef.current = engine;

    engine
      .init()
      .then(() => {
        setEngineReady(true);
      })
      .catch((err) => {
        console.error("Failed to init Stockfish:", err);
      });

    return () => {
      engine.quit();
    };
  }, []);

  // Check if it's bot's turn and make a move
  const makeBotMove = useCallback(async () => {
    const game = gameRef.current;
    if (gameEndedRef.current) return;
    if (game.isGameOver()) return;

    const isPlayerTurn =
      (playerColor === "white" && game.turn() === "w") ||
      (playerColor === "black" && game.turn() === "b");

    if (isPlayerTurn) return;

    setThinking(true);

    try {
      // Try opening book first
      if (openingBook && inBook) {
        const bookMoves = lookupPosition(openingBook, game.fen());
        if (bookMoves.length > 0) {
          // Weighted random selection based on frequency
          const totalWeight = bookMoves.reduce((s, m) => s + m.weight, 0);
          let rand = Math.random() * totalWeight;
          let selectedMove = bookMoves[0];

          for (const bm of bookMoves) {
            rand -= bm.weight;
            if (rand <= 0) {
              selectedMove = bm;
              break;
            }
          }

          const move = game.move({
            from: selectedMove.from as Square,
            to: selectedMove.to as Square,
            promotion: selectedMove.promotion as
              | "q"
              | "r"
              | "b"
              | "n"
              | undefined,
          });

          if (move) {
            setFen(game.fen());
            setThinking(false);
            checkGameEnd(game);
            return;
          }
        }

        // Out of book
        setInBook(false);
      }

      // Use Stockfish
      if (engineRef.current && engineReady) {
        const result = await engineRef.current.evaluate(game.fen(), depth);
        if (gameEndedRef.current) return;

        // Convert UCI move to chess.js format
        const from = result.bestMove.substring(0, 2) as Square;
        const to = result.bestMove.substring(2, 4) as Square;
        const promotion =
          result.bestMove.length > 4
            ? (result.bestMove[4] as "q" | "r" | "b" | "n")
            : undefined;

        const move = game.move({ from, to, promotion });
        if (move) {
          setFen(game.fen());
          checkGameEnd(game);
        }
      }
    } catch (err) {
      console.error("Bot move error:", err);
    } finally {
      setThinking(false);
    }
  }, [
    playerColor,
    openingBook,
    inBook,
    engineReady,
    depth,
    checkGameEnd,
  ]);

  // Trigger bot move when it's their turn
  useEffect(() => {
    if (!engineReady) return;

    const game = gameRef.current;
    const isPlayerTurn =
      (playerColor === "white" && game.turn() === "w") ||
      (playerColor === "black" && game.turn() === "b");

    if (!isPlayerTurn && !game.isGameOver()) {
      const timeout = setTimeout(makeBotMove, 500);
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
        promotion: "q", // auto-promote to queen
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
      <div className="flex items-center gap-3 text-sm">
        {inBook && (
          <span className="rounded-full bg-green-600/20 border border-green-500/30 px-3 py-1 text-green-400">
            Following {opponentUsername}&apos;s repertoire
          </span>
        )}
        {!inBook && (
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
          Depth: {depth} (~{fideEstimate} FIDE)
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

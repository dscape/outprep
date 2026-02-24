/**
 * Lichess API types — duplicated from src/lib/types.ts for harness independence.
 */

export interface RatingInfo {
  games: number;
  rating: number;
  rd: number;
  prog: number;
  prov?: boolean;
}

export interface LichessUser {
  id: string;
  username: string;
  perfs: {
    bullet?: RatingInfo;
    blitz?: RatingInfo;
    rapid?: RatingInfo;
    classical?: RatingInfo;
  };
  count?: {
    all: number;
    rated: number;
  };
}

export interface LichessEvalAnnotation {
  eval?: number; // centipawns from white's perspective
  mate?: number; // mate in N (positive = white mates)
}

export interface LichessGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  perf: string;
  status: string;
  players: {
    white: { user?: { name: string; id: string }; rating?: number };
    black: { user?: { name: string; id: string }; rating?: number };
  };
  winner?: "white" | "black";
  opening?: { eco: string; name: string; ply: number };
  moves: string;
  pgn?: string;
  clock?: { initial: number; increment: number };
  analysis?: LichessEvalAnnotation[];
}

export interface PlayerRatings {
  bullet?: number;
  blitz?: number;
  rapid?: number;
  classical?: number;
}

export interface RatingInfo {
  games: number;
  rating: number;
  rd: number;
  prog: number;
  prov?: boolean;
}

export interface StyleMetrics {
  aggression: number;
  tactical: number;
  positional: number;
  endgame: number;
  sampleSize: number;
}

export interface Weakness {
  area: string;
  severity: "critical" | "moderate" | "minor";
  description: string;
  stat: string;
  confidence?: "low" | "medium" | "high";
  eco?: string;           // ECO code, e.g. "A07"
  openingName?: string;   // Opening family name, e.g. "King's Indian Attack"
  opponentColor?: "white" | "black"; // Which color the opponent plays this weak opening as
}

export interface OpeningStats {
  eco: string;
  name: string;
  games: number;
  pct: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
}

export interface PrepTip {
  title: string;
  description: string;
}

export interface FIDEEstimate {
  rating: number;
  confidence: number;
}

export interface SpeedProfile {
  games: number;
  style: StyleMetrics;
  openings: { white: OpeningStats[]; black: OpeningStats[] };
  weaknesses: Weakness[];
  errorProfile?: ErrorProfile;
}

export interface PlayerProfile {
  username: string;
  platform: "lichess";
  totalGames: number;
  analyzedGames: number;
  ratings: PlayerRatings;
  fideEstimate: FIDEEstimate;
  style: StyleMetrics;
  weaknesses: Weakness[];
  openings: {
    white: OpeningStats[];
    black: OpeningStats[];
  };
  prepTips: PrepTip[];
  bySpeed: Record<string, SpeedProfile>;
  errorProfile?: ErrorProfile;
  lastComputed: number;
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
  createdAt?: number;
  analysis?: LichessEvalAnnotation[];
}

export interface MoveEval {
  ply: number;
  san: string;
  fen: string; // position BEFORE this move was played
  eval: number;
  bestMove: string;
  bestMoveSan: string;
  evalDelta: number;
  classification: "great" | "good" | "inaccuracy" | "mistake" | "blunder" | "normal";
  exploitMove?: string; // UCI — opponent's best response after this move (how they punish mistakes)
  description?: string; // English description of what went wrong
}

export interface AnalysisSummary {
  averageCentipawnLoss: number;
  accuracy: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
}

export type MomentTag = "EXPECTED" | "WELL PLAYED" | "BLUNDER" | "MISTAKE" | "INACCURACY" | "EXPLOITED" | "THEIR WEAKNESS";

export interface KeyMoment {
  moveNum: number;
  ply: number;
  san: string;
  bestMoveSan?: string;
  description: string;
  tag: MomentTag;
  eval: number;
  evalDelta: number;
  weaknessContext?: string;
}

export interface OTBGame {
  white: string;
  black: string;
  result: string; // "1-0" | "0-1" | "1/2-1/2"
  date?: string;
  event?: string;
  eco?: string;
  opening?: string;
  moves: string; // space-separated SAN
  pgn: string; // raw PGN text
}

export interface OTBProfile {
  games: OTBGame[];
  totalGames: number;
  style: StyleMetrics;
  openings: { white: OpeningStats[]; black: OpeningStats[] };
  weaknesses: Weakness[];
}

// Import + re-export shared types from the engine package (single source of truth).
// The import makes them available within this file; the export makes them available to consumers.
import type {
  PhaseErrors as _PhaseErrors,
  ErrorProfile as _ErrorProfile,
  GameEvalData as _GameEvalData,
} from "@outprep/engine";

export type PhaseErrors = _PhaseErrors;
export type ErrorProfile = _ErrorProfile;
export type GameEvalData = _GameEvalData;

export interface GameAnalysis {
  gameId: string;
  pgn: string;
  result: string;
  opening: string;
  totalMoves: number;
  playerColor: "white" | "black";
  opponentUsername: string;
  summary: AnalysisSummary;
  moves: MoveEval[];
  keyMoments: KeyMoment[];
  coachingNarrative: string;
  opponentFideEstimate?: number;
  scoutedUsername?: string; // When reviewing a scouted player's game (playerColor = scouted player's color)
}

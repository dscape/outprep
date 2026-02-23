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
}

export interface MoveEval {
  ply: number;
  san: string;
  eval: number;
  bestMove: string;
  evalDelta: number;
  classification: "great" | "good" | "inaccuracy" | "mistake" | "blunder" | "normal";
}

export interface AnalysisSummary {
  averageCentipawnLoss: number;
  accuracy: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
}

export type MomentTag = "EXPECTED" | "PREP HIT" | "YOUR ERROR" | "EXPLOITED" | "PREDICTED";

export interface KeyMoment {
  moveNum: number;
  description: string;
  tag: MomentTag;
  eval: number;
  evalDelta: number;
}

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
}

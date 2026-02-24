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

export interface PhaseErrors {
  totalMoves: number;
  inaccuracies: number;   // 50-100cp loss
  mistakes: number;       // 100-300cp loss
  blunders: number;       // 300+cp loss
  avgCPL: number;
  errorRate: number;      // (inaccuracies + mistakes + blunders) / totalMoves
  blunderRate: number;    // blunders / totalMoves
}

export interface ErrorProfile {
  opening: PhaseErrors;
  middlegame: PhaseErrors;
  endgame: PhaseErrors;
  overall: PhaseErrors;
  gamesAnalyzed: number;
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

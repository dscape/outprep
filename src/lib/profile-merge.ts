import type {
  PlayerProfile,
  StyleMetrics,
  OpeningStats,
  Weakness,
  PhaseErrors,
} from "@/lib/types";
import type { ErrorProfile } from "@outprep/engine";

export interface FilteredData {
  style: StyleMetrics;
  openings: { white: OpeningStats[]; black: OpeningStats[] };
  weaknesses: Weakness[];
  errorProfile?: ErrorProfile;
  games: number;
}

export const SPEED_ORDER = ["bullet", "blitz", "rapid", "classical"];

export const TIME_RANGES = [
  { key: "1m", label: "Last month", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "3m", label: "3 months", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "1y", label: "Last year", ms: 365 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All time", ms: 0 },
];

export function mergeOpenings(
  openingsSets: { white: OpeningStats[]; black: OpeningStats[] }[]
): { white: OpeningStats[]; black: OpeningStats[] } {
  const mergeColor = (lists: OpeningStats[][]): OpeningStats[] => {
    const map = new Map<
      string,
      {
        eco: string;
        name: string;
        wins: number;
        draws: number;
        losses: number;
        total: number;
      }
    >();
    for (const list of lists) {
      for (const op of list) {
        const existing = map.get(op.name);
        if (existing) {
          existing.total += op.games;
          existing.wins += Math.round((op.winRate / 100) * op.games);
          existing.draws += Math.round((op.drawRate / 100) * op.games);
          existing.losses += Math.round((op.lossRate / 100) * op.games);
        } else {
          map.set(op.name, {
            eco: op.eco,
            name: op.name,
            wins: Math.round((op.winRate / 100) * op.games),
            draws: Math.round((op.drawRate / 100) * op.games),
            losses: Math.round((op.lossRate / 100) * op.games),
            total: op.games,
          });
        }
      }
    }
    const totalGames = Array.from(map.values()).reduce(
      (sum, e) => sum + e.total,
      0
    );
    return Array.from(map.values())
      .filter((e) => e.total >= 2)
      .sort((a, b) => b.total - a.total)
      .slice(0, 15)
      .map((e) => ({
        eco: e.eco,
        name: e.name,
        games: e.total,
        pct: totalGames > 0 ? Math.round((e.total / totalGames) * 100) : 0,
        winRate: e.total > 0 ? Math.round((e.wins / e.total) * 100) : 0,
        drawRate: e.total > 0 ? Math.round((e.draws / e.total) * 100) : 0,
        lossRate: e.total > 0 ? Math.round((e.losses / e.total) * 100) : 0,
      }));
  };

  return {
    white: mergeColor(openingsSets.map((o) => o.white)),
    black: mergeColor(openingsSets.map((o) => o.black)),
  };
}

export function mergePhaseErrors(phases: PhaseErrors[]): PhaseErrors {
  let totalMoves = 0,
    mistakes = 0,
    blunders = 0,
    totalCPL = 0;
  for (const p of phases) {
    totalMoves += p.totalMoves;
    mistakes += p.mistakes;
    blunders += p.blunders;
    totalCPL += p.avgCPL * p.totalMoves;
  }
  const totalErrors = mistakes + blunders;
  return {
    totalMoves,
    mistakes,
    blunders,
    avgCPL: totalMoves > 0 ? Math.round(totalCPL / totalMoves) : 0,
    errorRate: totalMoves > 0 ? totalErrors / totalMoves : 0,
    blunderRate: totalMoves > 0 ? blunders / totalMoves : 0,
  };
}

export function mergeErrorProfiles(profiles: ErrorProfile[]): ErrorProfile {
  return {
    opening: mergePhaseErrors(profiles.map((p) => p.opening)),
    middlegame: mergePhaseErrors(profiles.map((p) => p.middlegame)),
    endgame: mergePhaseErrors(profiles.map((p) => p.endgame)),
    overall: mergePhaseErrors(profiles.map((p) => p.overall)),
    gamesAnalyzed: profiles.reduce((sum, p) => sum + p.gamesAnalyzed, 0),
  };
}

export function mergeSpeedProfiles(
  profile: PlayerProfile,
  speeds: string[]
): FilteredData {
  let totalGames = 0;
  let aggSum = 0,
    tacSum = 0,
    posSum = 0,
    endSum = 0;

  for (const s of speeds) {
    const sp = profile.bySpeed?.[s];
    if (!sp) continue;
    totalGames += sp.games;
    aggSum += sp.style.aggression * sp.games;
    tacSum += sp.style.tactical * sp.games;
    posSum += sp.style.positional * sp.games;
    endSum += sp.style.endgame * sp.games;
  }

  const style: StyleMetrics =
    totalGames > 0
      ? {
          aggression: Math.round(aggSum / totalGames),
          tactical: Math.round(tacSum / totalGames),
          positional: Math.round(posSum / totalGames),
          endgame: Math.round(endSum / totalGames),
          sampleSize: totalGames,
        }
      : profile.style;

  const openingsSets = speeds
    .map((s) => profile.bySpeed?.[s]?.openings)
    .filter(
      (o): o is { white: OpeningStats[]; black: OpeningStats[] } => !!o
    );
  const openings = mergeOpenings(openingsSets);

  const seen = new Set<string>();
  const weaknesses: Weakness[] = [];
  for (const s of speeds) {
    for (const w of profile.bySpeed?.[s]?.weaknesses || []) {
      if (!seen.has(w.area)) {
        seen.add(w.area);
        weaknesses.push(w);
      }
    }
  }

  const errorProfiles = speeds
    .map((s) => profile.bySpeed?.[s]?.errorProfile)
    .filter((e): e is ErrorProfile => !!e && e.gamesAnalyzed > 0);
  const errorProfile =
    errorProfiles.length > 0 ? mergeErrorProfiles(errorProfiles) : undefined;

  return { style, openings, weaknesses, errorProfile, games: totalGames };
}

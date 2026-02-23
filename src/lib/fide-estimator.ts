import { FIDEEstimate, LichessUser } from "./types";

interface TimeControlData {
  rating: number;
  games: number;
  rd: number;
  provisional: boolean;
}

// Lichess-to-FIDE conversion table based on ChessGoals community survey data.
// Linear interpolation between anchor points. Captures the nonlinear relationship:
// Lichess is deflated at lower levels and slightly inflated at higher levels.
const CONVERSION_TABLE: { lichess: number; fide: number }[] = [
  { lichess: 600,  fide: 750 },
  { lichess: 800,  fide: 1000 },
  { lichess: 1000, fide: 1250 },
  { lichess: 1200, fide: 1420 },
  { lichess: 1500, fide: 1575 },
  { lichess: 1800, fide: 1750 },
  { lichess: 2000, fide: 1900 },
  { lichess: 2200, fide: 2100 },
  { lichess: 2500, fide: 2400 },
];

// Time control config: offsets and weights for FIDE estimation.
// Bullet excluded — too unreliable for predicting OTB strength.
// Rapid/classical weighted higher as they're closest to OTB conditions.
const TC_CONFIG: Record<string, { offset: number; weight: number }> = {
  blitz:     { offset: 0,   weight: 1.5 },
  rapid:     { offset: 30,  weight: 2.5 },
  classical: { offset: 50,  weight: 3 },
};

const MIN_GAMES = 20;

/** Convert a Lichess rating to estimated FIDE via table interpolation */
function lichessToFide(lichessRating: number): number {
  const table = CONVERSION_TABLE;

  // Clamp below minimum
  if (lichessRating <= table[0].lichess) {
    return table[0].fide;
  }

  // Clamp above maximum
  if (lichessRating >= table[table.length - 1].lichess) {
    return table[table.length - 1].fide;
  }

  // Find bracketing points and linearly interpolate
  for (let i = 0; i < table.length - 1; i++) {
    const lo = table[i];
    const hi = table[i + 1];
    if (lichessRating >= lo.lichess && lichessRating <= hi.lichess) {
      const t = (lichessRating - lo.lichess) / (hi.lichess - lo.lichess);
      return Math.round(lo.fide + t * (hi.fide - lo.fide));
    }
  }

  // Fallback (should not reach here)
  return lichessRating;
}

export function estimateFIDE(user: LichessUser): FIDEEstimate {
  const timeControls: Record<string, TimeControlData> = {};

  for (const [tc, perf] of Object.entries(user.perfs || {})) {
    if (TC_CONFIG[tc] && perf) {
      timeControls[tc] = {
        rating: perf.rating,
        games: perf.games,
        rd: perf.rd,
        provisional: perf.prov ?? perf.games < MIN_GAMES,
      };
    }
  }

  let weightedSum = 0;
  let totalWeight = 0;
  let totalGames = 0;
  let avgRD = 0;
  let rdCount = 0;

  for (const [tc, data] of Object.entries(timeControls)) {
    if (data.provisional || data.games < MIN_GAMES) continue;

    const config = TC_CONFIG[tc];
    const baseFide = lichessToFide(data.rating);
    const estimated = baseFide + config.offset;
    const gameWeight = Math.min(data.games / 100, 1);
    const weight = config.weight * gameWeight;

    weightedSum += estimated * weight;
    totalWeight += weight;
    totalGames += data.games;
    avgRD += data.rd;
    rdCount++;
  }

  if (totalWeight === 0) {
    // Fallback: use any available rating even if provisional
    for (const [tc, data] of Object.entries(timeControls)) {
      const config = TC_CONFIG[tc];
      const baseFide = lichessToFide(data.rating);
      const estimated = baseFide + config.offset;
      const gameWeight = Math.min(data.games / 100, 1);
      const weight = config.weight * gameWeight;
      weightedSum += estimated * weight;
      totalWeight += weight;
      totalGames += data.games;
      avgRD += data.rd;
      rdCount++;
    }
  }

  if (totalWeight === 0) {
    return { rating: 1200, confidence: 0 };
  }

  const rating = Math.round(weightedSum / totalWeight);
  avgRD = rdCount > 0 ? avgRD / rdCount : 150;

  // Confidence based on games played and rating deviation
  const gamesConfidence = Math.min(totalGames / 500, 1) * 50;
  const rdConfidence = Math.max(0, (1 - avgRD / 150)) * 50;
  const confidence = Math.round(Math.min(gamesConfidence + rdConfidence, 100));

  return { rating, confidence };
}

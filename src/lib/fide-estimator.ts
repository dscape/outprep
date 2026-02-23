import { FIDEEstimate, LichessUser } from "./types";

interface TimeControlData {
  rating: number;
  games: number;
  rd: number;
  provisional: boolean;
}

const COEFFICIENTS: Record<string, { slope: number; intercept: number; weight: number }> = {
  bullet: { slope: 0.80, intercept: 20, weight: 1 },
  blitz: { slope: 0.83, intercept: -52, weight: 1 },
  rapid: { slope: 0.85, intercept: 12, weight: 2 },
  classical: { slope: 0.87, intercept: 45, weight: 2 },
};

const MIN_GAMES = 50;

export function estimateFIDE(user: LichessUser): FIDEEstimate {
  const timeControls: Record<string, TimeControlData> = {};

  for (const [tc, perf] of Object.entries(user.perfs || {})) {
    if (COEFFICIENTS[tc] && perf) {
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

    const coeff = COEFFICIENTS[tc];
    const estimated = coeff.slope * data.rating + coeff.intercept;
    const gameWeight = Math.min(data.games / 100, 1);
    const weight = coeff.weight * gameWeight;

    weightedSum += estimated * weight;
    totalWeight += weight;
    totalGames += data.games;
    avgRD += data.rd;
    rdCount++;
  }

  if (totalWeight === 0) {
    // Fallback: use any available rating even if provisional
    for (const [tc, data] of Object.entries(timeControls)) {
      const coeff = COEFFICIENTS[tc];
      const estimated = coeff.slope * data.rating + coeff.intercept;
      weightedSum += estimated * coeff.weight;
      totalWeight += coeff.weight;
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

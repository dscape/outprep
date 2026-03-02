import { Chess } from "chess.js";
import {
  LichessUser,
  PlayerProfile,
  SpeedProfile,
  StyleMetrics,
  Weakness,
  OpeningStats,
  PrepTip,
  PlayerRatings,
} from "./types";
import type { ErrorProfile } from "@outprep/engine";
import { buildErrorProfileFromEvals } from "@outprep/engine";
import { estimateFIDE } from "./fide-estimator";
import type { NormalizedGame } from "./normalized-game";
import { normalizedToGameEvalData } from "./normalized-game";

function buildErrorProfile(games: NormalizedGame[]): ErrorProfile {
  const evalData = games
    .map(normalizedToGameEvalData)
    .filter((d): d is NonNullable<typeof d> => d !== null);
  return buildErrorProfileFromEvals(evalData);
}

export function buildProfile(
  user: LichessUser,
  games: NormalizedGame[]
): PlayerProfile {
  const standardGames = games.filter((g) => (g.variant ?? "standard") === "standard");
  const analyzedGames = standardGames.length;

  const ratings = extractRatings(user);
  const fideEstimate = estimateFIDE(user);
  // Aggregate analysis (all speeds combined)
  const style = analyzeStyle(standardGames);
  const openings = analyzeOpenings(standardGames);
  const weaknesses = detectWeaknesses(standardGames, style, openings, analyzedGames);
  const prepTips = generatePrepTips(weaknesses, openings, style);
  const errorProfile = buildErrorProfile(standardGames);

  // Per-speed breakdowns (only when games have speed info)
  const bySpeed: Record<string, SpeedProfile> = {};
  const speedGroups = new Map<string, NormalizedGame[]>();
  for (const g of standardGames) {
    if (!g.speed) continue;
    const arr = speedGroups.get(g.speed) || [];
    arr.push(g);
    speedGroups.set(g.speed, arr);
  }
  for (const [speed, speedGames] of speedGroups) {
    const speedStyle = analyzeStyle(speedGames);
    const speedOpenings = analyzeOpenings(speedGames);
    const speedWeaknesses = detectWeaknesses(speedGames, speedStyle, speedOpenings, speedGames.length);
    const speedErrorProfile = buildErrorProfile(speedGames);
    bySpeed[speed] = {
      games: speedGames.length,
      style: speedStyle,
      openings: speedOpenings,
      weaknesses: speedWeaknesses,
      errorProfile: speedErrorProfile,
    };
  }

  return {
    username: user.username,
    platform: "lichess",
    totalGames: user.count?.rated ?? user.count?.all ?? games.length,
    analyzedGames,
    ratings,
    fideEstimate,
    style,
    weaknesses,
    openings,
    prepTips,
    bySpeed,
    errorProfile,
    lastComputed: Date.now(),
  };
}

function extractRatings(user: LichessUser): PlayerRatings {
  const ratings: PlayerRatings = {};
  if (user.perfs?.bullet && !user.perfs.bullet.prov) ratings.bullet = user.perfs.bullet.rating;
  if (user.perfs?.blitz && !user.perfs.blitz.prov) ratings.blitz = user.perfs.blitz.rating;
  if (user.perfs?.rapid && !user.perfs.rapid.prov) ratings.rapid = user.perfs.rapid.rating;
  if (user.perfs?.classical && !user.perfs.classical.prov) ratings.classical = user.perfs.classical.rating;
  return ratings;
}

export function analyzeStyle(games: NormalizedGame[]): StyleMetrics {
  let aggression = 50;
  let tactical = 50;
  let positional = 50;
  let endgame = 50;

  if (games.length === 0) return { aggression, tactical, positional, endgame, sampleSize: 0 };

  let earlyAttacks = 0;
  let sacrifices = 0;
  let tacticalWins = 0;
  let longGames = 0;
  let longGameWins = 0;
  let totalMoves = 0;
  let gamesAnalyzed = 0;

  for (const game of games) {
    if (!game.moves || (game.variant ?? "standard") !== "standard") continue;

    const moves = game.moves.split(" ");
    const moveCount = Math.floor(moves.length / 2);
    totalMoves += moveCount;
    gamesAnalyzed++;

    const isWhite = game.playerColor === "white";
    const won = (isWhite && game.result === "white") || (!isWhite && game.result === "black");

    // Aggression: short decisive games, early piece activity
    if (moveCount < 30 && won) earlyAttacks++;

    // Check for material sacrifices (rough heuristic from move patterns)
    try {
      const chess = new Chess();
      let prevMaterial = countMaterial(chess);
      const movesToCheck = Math.min(moves.length, 40);
      for (let i = 0; i < movesToCheck; i++) {
        try {
          chess.move(moves[i]);
          const material = countMaterial(chess);
          const myMaterial = isWhite
            ? material.white
            : material.black;
          const prevMyMaterial = isWhite
            ? prevMaterial.white
            : prevMaterial.black;
          if (prevMyMaterial - myMaterial >= 3 && i > 5) {
            sacrifices++;
          }
          prevMaterial = material;
        } catch {
          break;
        }
      }
    } catch {
      // skip malformed games
    }

    // Tactical: short decisive games suggest tactical play
    if (moveCount < 40 && game.result && game.result !== "draw") tacticalWins++;

    // Endgame: long games and conversion rate (30+ moves for blitz-friendliness)
    if (moveCount > 30) {
      longGames++;
      if (won) longGameWins++;
    }
  }

  if (gamesAnalyzed > 0) {
    const avgMoves = totalMoves / gamesAnalyzed;

    // Aggression: % of games won quickly + sacrifice frequency
    const earlyWinPct = (earlyAttacks / gamesAnalyzed) * 100;
    const sacrificePct = (sacrifices / gamesAnalyzed) * 100;
    aggression = Math.min(100, Math.round(earlyWinPct * 0.7 + sacrificePct * 0.3));

    // Tactical: % of decisive games that ended in under 40 moves
    tactical = Math.min(100, Math.round((tacticalWins / gamesAnalyzed) * 100));

    // Positional: inverse of early-loss rate, bonus for longer average game length
    const earlyLosses = games.filter((g) => {
      const moves = g.moves?.split(" ") || [];
      const moveCount = Math.floor(moves.length / 2);
      const isWhite = g.playerColor === "white";
      const lost = (isWhite && g.result === "black") || (!isWhite && g.result === "white");
      return moveCount < 25 && lost;
    }).length;
    const earlyLossPct = (earlyLosses / gamesAnalyzed) * 100;
    const lengthBonus = Math.min(20, Math.max(0, (avgMoves - 25) * 0.8));
    positional = clamp(Math.round(70 - earlyLossPct * 1.5 + lengthBonus), 0, 100);

    // Endgame: conversion rate in long games (30+ moves)
    endgame = longGames > 0
      ? Math.min(100, Math.round((longGameWins / longGames) * 100))
      : 50;
  }

  // Bayesian dampening: pull toward 50 (neutral) when sample is small
  return {
    aggression: clamp(Math.round(dampen(aggression, gamesAnalyzed)), 0, 100),
    tactical: clamp(Math.round(dampen(tactical, gamesAnalyzed)), 0, 100),
    positional: clamp(Math.round(dampen(positional, gamesAnalyzed)), 0, 100),
    endgame: clamp(Math.round(dampen(endgame, gamesAnalyzed)), 0, 100),
    sampleSize: gamesAnalyzed,
  };
}

function countMaterial(chess: Chess): { white: number; black: number } {
  const board = chess.board();
  let white = 0;
  let black = 0;
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  for (const row of board) {
    for (const square of row) {
      if (square) {
        const val = values[square.type] || 0;
        if (square.color === "w") white += val;
        else black += val;
      }
    }
  }

  return { white, black };
}

interface OpeningAccumulator {
  ecoMap: Map<string, number>;
  name: string;
  wins: number;
  draws: number;
  losses: number;
  total: number;
}

export function analyzeOpenings(
  games: NormalizedGame[],
  minGames: number = 1,
): { white: OpeningStats[]; black: OpeningStats[] } {
  const whiteMap = new Map<string, OpeningAccumulator>();
  const blackMap = new Map<string, OpeningAccumulator>();

  for (const game of games) {
    if (!game.opening.name || game.opening.name === "Unknown") {
      if ((game.variant ?? "standard") !== "standard") continue;
    }
    if ((game.variant ?? "standard") !== "standard") continue;

    const isWhite = game.playerColor === "white";
    const map = isWhite ? whiteMap : blackMap;
    const key = game.opening.family;

    if (!map.has(key)) {
      map.set(key, {
        ecoMap: new Map<string, number>(),
        name: key,
        wins: 0,
        draws: 0,
        losses: 0,
        total: 0,
      });
    }

    const entry = map.get(key)!;
    entry.total++;
    if (game.opening.eco) {
      entry.ecoMap.set(game.opening.eco, (entry.ecoMap.get(game.opening.eco) || 0) + 1);
    }

    if (game.result === "draw" || !game.result) {
      entry.draws++;
    } else if ((isWhite && game.result === "white") || (!isWhite && game.result === "black")) {
      entry.wins++;
    } else {
      entry.losses++;
    }
  }

  const toStats = (map: Map<string, OpeningAccumulator>): OpeningStats[] => {
    const totalGames = Array.from(map.values()).reduce((sum, e) => sum + e.total, 0);
    return Array.from(map.values())
      .filter((e) => e.total >= minGames)
      .sort((a, b) => b.total - a.total)
      .map((e) => {
        // Resolve to the most frequent ECO code in the group
        let bestEco = "";
        let bestCount = 0;
        for (const [eco, count] of e.ecoMap) {
          if (count > bestCount) {
            bestEco = eco;
            bestCount = count;
          }
        }
        return {
          eco: bestEco,
          name: e.name,
          games: e.total,
          pct: totalGames > 0 ? Math.round((e.total / totalGames) * 100) : 0,
          winRate: Math.round((e.wins / e.total) * 100),
          drawRate: Math.round((e.draws / e.total) * 100),
          lossRate: Math.round((e.losses / e.total) * 100),
        };
      });
  };

  return {
    white: toStats(whiteMap),
    black: toStats(blackMap),
  };
}

/** Extract opening family name (before first colon).
 *  e.g. "Italian Game: Giuoco Piano" → "Italian Game" */
export function openingFamily(name: string): string {
  const idx = name.indexOf(":");
  return idx > 0 ? name.substring(0, idx).trim() : name.trim();
}

export function detectWeaknesses(
  games: NormalizedGame[],
  style: StyleMetrics,
  openings: { white: OpeningStats[]; black: OpeningStats[] },
  analyzedGames: number
): Weakness[] {
  const weaknesses: Weakness[] = [];
  const conf = getConfidence(analyzedGames);

  // Check for endgame weakness
  if (style.endgame < 40) {
    weaknesses.push({
      area: "Endgame Conversion",
      severity: style.endgame < 25 ? "critical" : "moderate",
      description: "Struggles to convert advantages in long games. Many drawn or lost positions from winning middlegames.",
      stat: `${style.endgame}% endgame rating`,
      confidence: conf,
    });
  }

  // Check for tactical vulnerability
  let quickLosses = 0;
  let totalStandard = 0;
  for (const game of games) {
    if ((game.variant ?? "standard") !== "standard" || !game.moves) continue;
    totalStandard++;
    const moves = game.moves.split(" ");
    const moveCount = Math.floor(moves.length / 2);
    const isWhite = game.playerColor === "white";
    const lost = (isWhite && game.result === "black") || (!isWhite && game.result === "white");
    if (moveCount < 25 && lost) quickLosses++;
  }

  if (totalStandard > 0) {
    const quickLossRate = quickLosses / totalStandard;
    if (quickLossRate > 0.15) {
      weaknesses.push({
        area: "Tactical Vulnerability",
        severity: quickLossRate > 0.25 ? "critical" : "moderate",
        description: "Frequently loses games in under 25 moves, suggesting vulnerability to tactical combinations.",
        stat: `${Math.round(quickLossRate * 100)}% quick loss rate`,
        confidence: conf,
      });
    }
  }

  // Check opening repertoire weaknesses (preserve which color opponent plays)
  for (const op of openings.white) {
    if (op.games >= 5 && op.lossRate > 55) {
      weaknesses.push({
        area: `Weak in ${op.name}`,
        severity: op.lossRate > 70 ? "critical" : "moderate",
        description: `Poor results playing ${op.name} as White (${op.eco}).`,
        stat: `${op.lossRate}% loss rate in ${op.games} games`,
        confidence: conf,
        eco: op.eco,
        openingName: op.name,
        opponentColor: "white",
      });
    }
  }
  for (const op of openings.black) {
    if (op.games >= 5 && op.lossRate > 55) {
      weaknesses.push({
        area: `Weak in ${op.name}`,
        severity: op.lossRate > 70 ? "critical" : "moderate",
        description: `Poor results playing ${op.name} as Black (${op.eco}).`,
        stat: `${op.lossRate}% loss rate in ${op.games} games`,
        confidence: conf,
        eco: op.eco,
        openingName: op.name,
        opponentColor: "black",
      });
    }
  }

  // Check positional play
  if (style.positional < 35) {
    weaknesses.push({
      area: "Positional Understanding",
      severity: "moderate",
      description: "Tends to lose slowly in strategic positions. May struggle with pawn structures and piece placement.",
      stat: `${style.positional}% positional rating`,
      confidence: conf,
    });
  }

  // Time trouble indicator
  const timeControlGames = games.filter((g) => g.clock);
  let timeTroubleCount = 0;
  for (const game of timeControlGames) {
    const moves = game.moves?.split(" ") || [];
    if (moves.length > 60) timeTroubleCount++;
  }
  if (timeControlGames.length > 10 && timeTroubleCount / timeControlGames.length > 0.3) {
    weaknesses.push({
      area: "Time Management",
      severity: "minor",
      description: "Many games go to high move counts, suggesting potential time trouble in longer games.",
      stat: `${Math.round((timeTroubleCount / timeControlGames.length) * 100)}% long games`,
      confidence: conf,
    });
  }

  return weaknesses.slice(0, 6);
}

function getConfidence(analyzedGames: number): "low" | "medium" | "high" {
  if (analyzedGames < 30) return "low";
  if (analyzedGames < 100) return "medium";
  return "high";
}

/**
 * Enrich existing weaknesses with error-profile data from engine analysis.
 * Adds new phase-specific weaknesses and updates severity of existing ones.
 */
export function detectWeaknessesFromErrorProfile(
  errorProfile: ErrorProfile,
  existingWeaknesses: Weakness[]
): Weakness[] {
  const updated = [...existingWeaknesses];
  const conf: "low" | "medium" | "high" =
    errorProfile.gamesAnalyzed < 10 ? "low" :
    errorProfile.gamesAnalyzed < 30 ? "medium" : "high";

  // Opening phase has disproportionate errors
  if (
    errorProfile.opening.totalMoves >= 10 &&
    errorProfile.overall.errorRate > 0 &&
    errorProfile.opening.errorRate > errorProfile.overall.errorRate * 1.5
  ) {
    const exists = updated.some(w => w.area === "Opening Inaccuracy");
    if (!exists) {
      updated.push({
        area: "Opening Inaccuracy",
        severity: errorProfile.opening.errorRate > 0.15 ? "critical" : "moderate",
        description: `Makes ${(errorProfile.opening.errorRate * 100).toFixed(1)}% errors in the opening phase, significantly above their overall ${(errorProfile.overall.errorRate * 100).toFixed(1)}% rate.`,
        stat: `${(errorProfile.opening.errorRate * 100).toFixed(1)}% opening error rate`,
        confidence: conf,
      });
    }
  }

  // Middlegame blunder tendency
  if (
    errorProfile.middlegame.totalMoves >= 20 &&
    errorProfile.middlegame.blunderRate > 0.05
  ) {
    const exists = updated.some(w => w.area === "Middlegame Blunders");
    if (!exists) {
      updated.push({
        area: "Middlegame Blunders",
        severity: errorProfile.middlegame.blunderRate > 0.08 ? "critical" : "moderate",
        description: `Blunders ${(errorProfile.middlegame.blunderRate * 100).toFixed(1)}% of middlegame moves, suggesting vulnerability in complex positions.`,
        stat: `${(errorProfile.middlegame.blunderRate * 100).toFixed(1)}% middlegame blunder rate`,
        confidence: conf,
      });
    }
  }

  // Update severity of existing endgame weakness if error profile confirms it
  if (errorProfile.endgame.totalMoves >= 10) {
    const endgameWeakness = updated.find(w => w.area === "Endgame Conversion");
    if (endgameWeakness && errorProfile.overall.errorRate > 0 &&
        errorProfile.endgame.errorRate > errorProfile.overall.errorRate * 1.3) {
      endgameWeakness.severity = errorProfile.endgame.errorRate > 0.15 ? "critical" : "moderate";
      endgameWeakness.stat = `${(errorProfile.endgame.errorRate * 100).toFixed(1)}% endgame error rate`;
    }
  }

  return updated.slice(0, 8);
}

export function generatePrepTips(
  weaknesses: Weakness[],
  openings: { white: OpeningStats[]; black: OpeningStats[] },
  style: StyleMetrics
): PrepTip[] {
  const tips: PrepTip[] = [];

  // Opening prep
  const topWhite = openings.white[0];
  const topBlack = openings.black[0];

  if (topWhite) {
    tips.push({
      title: `Prepare against ${topWhite.name}`,
      description: `They play ${topWhite.name} (${topWhite.eco}) in ${topWhite.pct}% of their White games. Study the main lines and have a solid response ready.`,
    });
  }

  if (topBlack) {
    tips.push({
      title: `Expect ${topBlack.name} as Black`,
      description: `Their go-to defense is ${topBlack.name} (${topBlack.eco}), used in ${topBlack.pct}% of Black games. Prepare your attacking repertoire against this.`,
    });
  }

  // Style-based tips
  if (style.aggression > 70) {
    tips.push({
      title: "Play solidly against their aggression",
      description: "This player is highly aggressive. Avoid sharp tactical lines where they feel comfortable. Aim for solid, positional play and let them overextend.",
    });
  } else if (style.aggression < 30) {
    tips.push({
      title: "Take the initiative early",
      description: "This player prefers quiet positions. Seize the initiative with active piece play and create complications they may not handle well.",
    });
  }

  // Weakness exploitation tips
  for (const weakness of weaknesses.filter((w) => w.severity === "critical").slice(0, 2)) {
    if (weakness.area === "Endgame Conversion") {
      tips.push({
        title: "Steer into endgames",
        description: "Their endgame is weak. Trade pieces when you have an advantage and aim for technical endgame positions.",
      });
    } else if (weakness.area === "Tactical Vulnerability") {
      tips.push({
        title: "Create tactical complications",
        description: "They are prone to tactical mistakes. Keep the position complex with many pieces on the board.",
      });
    } else if (weakness.area.startsWith("Weak in")) {
      tips.push({
        title: `Exploit their ${weakness.area.replace("Weak in ", "")} weakness`,
        description: weakness.description,
      });
    }
  }

  return tips.slice(0, 5);
}

/** Bayesian dampening: pull raw score toward 50 (neutral) when sample is small */
function dampen(raw: number, n: number, k = 30): number {
  return raw * (n / (n + k)) + 50 * (k / (n + k));
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

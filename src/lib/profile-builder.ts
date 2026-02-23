import { Chess } from "chess.js";
import {
  LichessUser,
  LichessGame,
  PlayerProfile,
  StyleMetrics,
  Weakness,
  OpeningStats,
  PrepTip,
  PlayerRatings,
} from "./types";
import { estimateFIDE } from "./fide-estimator";

export function buildProfile(
  user: LichessUser,
  games: LichessGame[]
): PlayerProfile {
  const ratings = extractRatings(user);
  const fideEstimate = estimateFIDE(user);
  const style = analyzeStyle(games, user.username);
  const openings = analyzeOpenings(games, user.username);
  const weaknesses = detectWeaknesses(games, user.username, style, openings);
  const prepTips = generatePrepTips(weaknesses, openings, style);

  return {
    username: user.username,
    platform: "lichess",
    totalGames: user.count?.all ?? games.length,
    ratings,
    fideEstimate,
    style,
    weaknesses,
    openings,
    prepTips,
    lastComputed: Date.now(),
  };
}

function extractRatings(user: LichessUser): PlayerRatings {
  const ratings: PlayerRatings = {};
  if (user.perfs?.bullet) ratings.bullet = user.perfs.bullet.rating;
  if (user.perfs?.blitz) ratings.blitz = user.perfs.blitz.rating;
  if (user.perfs?.rapid) ratings.rapid = user.perfs.rapid.rating;
  if (user.perfs?.classical) ratings.classical = user.perfs.classical.rating;
  return ratings;
}

function analyzeStyle(games: LichessGame[], username: string): StyleMetrics {
  let aggression = 50;
  let tactical = 50;
  let positional = 50;
  let endgame = 50;

  if (games.length === 0) return { aggression, tactical, positional, endgame };

  let earlyAttacks = 0;
  let sacrifices = 0;
  let tacticalWins = 0;
  let longGames = 0;
  let longGameWins = 0;
  let totalMoves = 0;
  let gamesAnalyzed = 0;

  for (const game of games) {
    if (!game.moves || game.variant !== "standard") continue;

    const moves = game.moves.split(" ");
    const moveCount = Math.floor(moves.length / 2);
    totalMoves += moveCount;
    gamesAnalyzed++;

    const isWhite = game.players.white?.user?.id?.toLowerCase() === username.toLowerCase();
    const won = (isWhite && game.winner === "white") || (!isWhite && game.winner === "black");

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
          const playerIsWhite = isWhite;
          const myMaterial = playerIsWhite
            ? material.white
            : material.black;
          const prevMyMaterial = playerIsWhite
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
    if (moveCount < 40 && game.winner) tacticalWins++;

    // Endgame: long games and conversion rate
    if (moveCount > 40) {
      longGames++;
      if (won) longGameWins++;
    }
  }

  if (gamesAnalyzed > 0) {
    const avgMoves = totalMoves / gamesAnalyzed;

    // Aggression: sacrifice frequency + early decisive games
    aggression = Math.min(100, Math.round(
      (earlyAttacks / gamesAnalyzed) * 200 +
      (sacrifices / gamesAnalyzed) * 150 +
      Math.max(0, (30 - avgMoves)) * 2
    ));

    // Tactical: short decisive wins ratio
    tactical = Math.min(100, Math.round(
      (tacticalWins / gamesAnalyzed) * 150 +
      (earlyAttacks / gamesAnalyzed) * 100
    ));

    // Positional: longer games, fewer blunders (inverse of early losses)
    const earlyLosses = games.filter((g) => {
      const moves = g.moves?.split(" ") || [];
      const moveCount = Math.floor(moves.length / 2);
      const isWhite = g.players.white?.user?.id?.toLowerCase() === username.toLowerCase();
      const lost = (isWhite && g.winner === "black") || (!isWhite && g.winner === "white");
      return moveCount < 25 && lost;
    }).length;
    positional = Math.min(100, Math.round(
      70 - (earlyLosses / gamesAnalyzed) * 100 +
      Math.min(avgMoves, 50)
    ));

    // Endgame: conversion rate in long games
    endgame = longGames > 0
      ? Math.min(100, Math.round((longGameWins / longGames) * 120))
      : 40;
  }

  return {
    aggression: clamp(aggression, 0, 100),
    tactical: clamp(tactical, 0, 100),
    positional: clamp(positional, 0, 100),
    endgame: clamp(endgame, 0, 100),
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

function analyzeOpenings(
  games: LichessGame[],
  username: string
): { white: OpeningStats[]; black: OpeningStats[] } {
  const whiteMap = new Map<string, { eco: string; name: string; wins: number; draws: number; losses: number; total: number }>();
  const blackMap = new Map<string, { eco: string; name: string; wins: number; draws: number; losses: number; total: number }>();

  for (const game of games) {
    if (!game.opening || game.variant !== "standard") continue;

    const isWhite = game.players.white?.user?.id?.toLowerCase() === username.toLowerCase();
    const map = isWhite ? whiteMap : blackMap;
    const key = game.opening.eco;

    if (!map.has(key)) {
      map.set(key, {
        eco: game.opening.eco,
        name: game.opening.name,
        wins: 0,
        draws: 0,
        losses: 0,
        total: 0,
      });
    }

    const entry = map.get(key)!;
    entry.total++;

    if (!game.winner) {
      entry.draws++;
    } else if ((isWhite && game.winner === "white") || (!isWhite && game.winner === "black")) {
      entry.wins++;
    } else {
      entry.losses++;
    }
  }

  const toStats = (map: Map<string, { eco: string; name: string; wins: number; draws: number; losses: number; total: number }>): OpeningStats[] => {
    const totalGames = Array.from(map.values()).reduce((sum, e) => sum + e.total, 0);
    return Array.from(map.values())
      .filter((e) => e.total >= 2)
      .sort((a, b) => b.total - a.total)
      .slice(0, 15)
      .map((e) => ({
        eco: e.eco,
        name: e.name,
        games: e.total,
        pct: totalGames > 0 ? Math.round((e.total / totalGames) * 100) : 0,
        winRate: Math.round((e.wins / e.total) * 100),
        drawRate: Math.round((e.draws / e.total) * 100),
        lossRate: Math.round((e.losses / e.total) * 100),
      }));
  };

  return {
    white: toStats(whiteMap),
    black: toStats(blackMap),
  };
}

function detectWeaknesses(
  games: LichessGame[],
  username: string,
  style: StyleMetrics,
  openings: { white: OpeningStats[]; black: OpeningStats[] }
): Weakness[] {
  const weaknesses: Weakness[] = [];

  // Check for endgame weakness
  if (style.endgame < 40) {
    weaknesses.push({
      area: "Endgame Conversion",
      severity: style.endgame < 25 ? "critical" : "moderate",
      description: "Struggles to convert advantages in long games. Many drawn or lost positions from winning middlegames.",
      stat: `${style.endgame}% endgame rating`,
    });
  }

  // Check for tactical vulnerability
  let quickLosses = 0;
  let totalStandard = 0;
  for (const game of games) {
    if (game.variant !== "standard" || !game.moves) continue;
    totalStandard++;
    const moves = game.moves.split(" ");
    const moveCount = Math.floor(moves.length / 2);
    const isWhite = game.players.white?.user?.id?.toLowerCase() === username.toLowerCase();
    const lost = (isWhite && game.winner === "black") || (!isWhite && game.winner === "white");
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
      });
    }
  }

  // Check opening repertoire weaknesses
  const allOpenings = [...openings.white, ...openings.black];
  for (const op of allOpenings) {
    if (op.games >= 5 && op.lossRate > 55) {
      weaknesses.push({
        area: `Weak in ${op.name}`,
        severity: op.lossRate > 70 ? "critical" : "moderate",
        description: `Poor results with ${op.name} (${op.eco}). Consider studying this line or switching to a different opening.`,
        stat: `${op.lossRate}% loss rate in ${op.games} games`,
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
    });
  }

  return weaknesses.slice(0, 6);
}

function generatePrepTips(
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

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

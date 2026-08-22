import { sqlTransaction } from "./db";
import { EXCLUDED_FIDE_IDS } from "./exclusions";

type Tx = Parameters<Parameters<typeof sqlTransaction>[0]>[0];

export interface ExclusionPurgeReport {
  fideIds: string[];
  playerSlugs: string[];
  playerAliasSlugs: string[];
  gameSlugs: string[];
  affectedOpponentIds: string[];
  affectedEvents: string[];
  applied: boolean;
}

interface RemainingGame {
  slug: string;
  white_name: string;
  black_name: string;
  white_slug: string | null;
  black_slug: string | null;
  white_fide_id: string;
  black_fide_id: string;
  white_elo: number;
  black_elo: number;
  event: string;
  date: Date;
  opening: string | null;
  eco: string | null;
  result: string;
}

export async function purgeExcludedPlayers(
  apply: boolean,
): Promise<ExclusionPurgeReport> {
  return sqlTransaction(async (tx) => {
    const playerRows = await tx`
      SELECT slug, fide_id
      FROM players
      WHERE fide_id = ANY(${[...EXCLUDED_FIDE_IDS]})
    `;
    const playerSlugs = playerRows.map((row) => row.slug as string);
    const playerAliasRows = playerSlugs.length > 0
      ? await tx`
          SELECT alias_slug
          FROM player_aliases
          WHERE canonical_slug = ANY(${playerSlugs})
        `
      : [];
    const playerAliasSlugs = playerAliasRows.map((row) => row.alias_slug as string);

    const gameRows = await tx`
      SELECT slug, event, white_fide_id, black_fide_id
      FROM games
      WHERE white_fide_id = ANY(${[...EXCLUDED_FIDE_IDS]})
         OR black_fide_id = ANY(${[...EXCLUDED_FIDE_IDS]})
    `;
    const gameSlugs = gameRows.map((row) => row.slug as string);
    const affectedEvents = unique(
      gameRows.map((row) => row.event as string).filter(Boolean),
    );
    const affectedOpponentIds = unique(
      gameRows.flatMap((row) => [
        row.white_fide_id as string,
        row.black_fide_id as string,
      ]).filter((id) => !EXCLUDED_FIDE_IDS.includes(id)),
    );

    const report: ExclusionPurgeReport = {
      fideIds: [...EXCLUDED_FIDE_IDS],
      playerSlugs,
      playerAliasSlugs,
      gameSlugs,
      affectedOpponentIds,
      affectedEvents,
      applied: apply,
    };

    if (!apply) return report;

    const affectedPlayerRows = affectedOpponentIds.length > 0
      ? await tx`
          SELECT fide_id, slug
          FROM players
          WHERE fide_id = ANY(${affectedOpponentIds})
        `
      : [];
    const cacheSlugs = unique([
      ...playerSlugs,
      ...playerAliasSlugs,
      ...EXCLUDED_FIDE_IDS,
      ...affectedPlayerRows.map((row) => row.slug as string),
    ]);

    const excludedSlugPatterns = EXCLUDED_FIDE_IDS.map((id) => `%${id}%`);
    await tx`
      DELETE FROM game_aliases
      WHERE canonical_slug LIKE ANY(${excludedSlugPatterns})
         OR legacy_slug LIKE ANY(${excludedSlugPatterns})
         OR canonical_slug = ANY(${gameSlugs})
    `;

    if (cacheSlugs.length > 0) {
      await deleteCaches(tx, cacheSlugs);
    }

    await tx`
      DELETE FROM player_aliases
      WHERE canonical_slug LIKE ANY(${excludedSlugPatterns})
         OR alias_slug LIKE ANY(${excludedSlugPatterns})
         OR canonical_slug = ANY(${playerSlugs})
    `;

    await tx`
      DELETE FROM games
      WHERE white_fide_id = ANY(${[...EXCLUDED_FIDE_IDS]})
         OR black_fide_id = ANY(${[...EXCLUDED_FIDE_IDS]})
    `;
    await tx`DELETE FROM players WHERE fide_id = ANY(${[...EXCLUDED_FIDE_IDS]})`;

    for (const row of affectedPlayerRows) {
      await rebuildPlayerAggregates(
        tx,
        row.fide_id as string,
        row.slug as string,
      );
    }

    for (const eventName of affectedEvents) {
      await rebuildEvent(tx, eventName);
    }

    return report;
  });
}

async function deleteCaches(tx: Tx, slugs: string[]): Promise<void> {
  const excludedPatterns = EXCLUDED_FIDE_IDS.map((id) => `%${id}%`);
  const tables = await tx`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = ANY(${[
        "fide_profiles",
        "game_evals",
        "bot_data_cache",
      ]})
  `;
  const present = new Set(tables.map((row) => row.tablename as string));

  if (present.has("fide_profiles")) {
    await tx`
      DELETE FROM fide_profiles
      WHERE slug = ANY(${slugs}) OR slug LIKE ANY(${excludedPatterns})
    `;
  }
  if (present.has("game_evals")) {
    await tx`
      DELETE FROM game_evals
      WHERE platform = 'fide'
        AND (
          username = ANY(${slugs.map((slug) => slug.toLowerCase())})
          OR username LIKE ANY(${excludedPatterns})
        )
    `;
  }
  if (present.has("bot_data_cache")) {
    await tx`
      DELETE FROM bot_data_cache
      WHERE platform = 'fide'
        AND (
          username = ANY(${slugs.map((slug) => slug.toLowerCase())})
          OR username LIKE ANY(${excludedPatterns})
        )
    `;
  }
}

async function rebuildPlayerAggregates(
  tx: Tx,
  fideId: string,
  playerSlug: string,
): Promise<void> {
  const games = await tx`
    SELECT slug, white_name, black_name, white_slug, black_slug,
           white_fide_id, black_fide_id, white_elo, black_elo,
           event, date, opening, eco, result
    FROM games
    WHERE white_fide_id = ${fideId} OR black_fide_id = ${fideId}
    ORDER BY date DESC
  ` as unknown as RemainingGame[];

  const stats = derivePlayerAggregates(games, fideId, playerSlug);
  await tx`
    UPDATE players
    SET game_count = ${stats.gameCount},
        fide_rating = COALESCE(${stats.fideRating}, fide_rating),
        win_rate = ${stats.winRate},
        draw_rate = ${stats.drawRate},
        loss_rate = ${stats.lossRate},
        last_seen = ${stats.lastSeen},
        recent_events = ${JSON.stringify(stats.recentEvents)}::jsonb,
        openings = ${JSON.stringify(stats.openings)}::jsonb,
        recent_games = ${JSON.stringify(stats.recentGames)}::jsonb,
        notable_games = ${JSON.stringify(stats.notableGames)}::jsonb,
        updated_at = NOW()
    WHERE fide_id = ${fideId}
  `;
}

export function derivePlayerAggregates(
  games: RemainingGame[],
  fideId: string,
  playerSlug: string,
) {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  const eventDates = new Map<string, string>();
  const whiteOpenings = new Map<string, OpeningAccumulator>();
  const blackOpenings = new Map<string, OpeningAccumulator>();

  const recentCandidates: RecentGame[] = [];
  const notableCandidates: Array<{ game: RecentGame; score: number }> = [];

  for (const game of games) {
    const isWhite = game.white_fide_id === fideId;
    const result = resultForPlayer(game.result, isWhite);
    if (result === "Won") wins++;
    else if (result === "Draw") draws++;
    else losses++;

    const date = formatDate(game.date);
    if (game.event) {
      const previous = eventDates.get(game.event);
      if (!previous || date > previous) eventDates.set(game.event, date);
    }

    addOpening(
      isWhite ? whiteOpenings : blackOpenings,
      game.opening || game.eco || "Unknown",
      game.eco || "",
      result,
    );

    const opponentName = isWhite ? game.black_name : game.white_name;
    const opponentElo = isWhite ? game.black_elo : game.white_elo;
    const opponentSlug = isWhite ? game.black_slug : game.white_slug;
    const summary: RecentGame = {
      slug: game.slug,
      opponentName,
      opponentElo,
      result,
      event: game.event,
      date,
      opening: game.opening,
      isWhite,
    };
    recentCandidates.push(summary);
    notableCandidates.push({
      game: summary,
      score: opponentElo + (result === "Won" ? 100 : result === "Lost" ? 50 : 0) + (opponentSlug ? 50 : 0),
    });
  }

  recentCandidates.sort((a, b) => b.date.localeCompare(a.date));
  const recentGames = recentCandidates.slice(0, 10);
  const recentSlugs = new Set(recentGames.map((game) => game.slug));
  notableCandidates.sort((a, b) => b.score - a.score);
  const opponentCounts = new Map<string, number>();
  const notableGames: RecentGame[] = [];
  for (const candidate of notableCandidates) {
    if (notableGames.length >= 10) break;
    if (recentSlugs.has(candidate.game.slug)) continue;
    const count = opponentCounts.get(candidate.game.opponentName) ?? 0;
    if (count >= 2) continue;
    opponentCounts.set(candidate.game.opponentName, count + 1);
    notableGames.push(candidate.game);
  }

  const gameCount = games.length;
  const latestGame = games[0];
  const fideRating = latestGame
    ? latestGame.white_fide_id === fideId
      ? latestGame.white_elo
      : latestGame.black_elo
    : null;
  return {
    playerSlug,
    gameCount,
    fideRating,
    winRate: gameCount ? Math.round((wins / gameCount) * 100) : 0,
    drawRate: gameCount ? Math.round((draws / gameCount) * 100) : 0,
    lossRate: gameCount ? Math.round((losses / gameCount) * 100) : 0,
    lastSeen: games[0]?.date ?? null,
    recentEvents: [...eventDates.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, 5)
      .map(([event]) => event),
    openings: {
      white: finalizeOpenings(whiteOpenings),
      black: finalizeOpenings(blackOpenings),
    },
    recentGames,
    notableGames,
  };
}

type RecentGame = {
  slug: string;
  opponentName: string;
  opponentElo: number;
  result: "Won" | "Lost" | "Draw";
  event: string;
  date: string;
  opening: string | null;
  isWhite: boolean;
};

type OpeningAccumulator = {
  ecoCounts: Map<string, number>;
  games: number;
  wins: number;
  draws: number;
  losses: number;
};

function addOpening(
  map: Map<string, OpeningAccumulator>,
  opening: string,
  eco: string,
  result: RecentGame["result"],
): void {
  const family = opening.split(":", 1)[0].trim() || "Unknown";
  const entry = map.get(family) ?? {
    ecoCounts: new Map(),
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
  };
  entry.games++;
  if (eco) entry.ecoCounts.set(eco, (entry.ecoCounts.get(eco) ?? 0) + 1);
  if (result === "Won") entry.wins++;
  else if (result === "Draw") entry.draws++;
  else entry.losses++;
  map.set(family, entry);
}

function finalizeOpenings(map: Map<string, OpeningAccumulator>) {
  const total = [...map.values()].reduce((sum, entry) => sum + entry.games, 0);
  return [...map.entries()]
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, 15)
    .map(([name, entry]) => ({
      eco: [...entry.ecoCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      name,
      games: entry.games,
      pct: total ? Math.round((entry.games / total) * 100) : 0,
      winRate: Math.round((entry.wins / entry.games) * 100),
      drawRate: Math.round((entry.draws / entry.games) * 100),
      lossRate: Math.round((entry.losses / entry.games) * 100),
    }));
}

async function rebuildEvent(tx: Tx, eventName: string): Promise<void> {
  const rows = await tx`
    SELECT MIN(site) AS site, MIN(date) AS date_start, MAX(date) AS date_end,
           COUNT(*)::int AS game_count, (AVG(avg_elo))::smallint AS avg_elo
    FROM games
    WHERE event = ${eventName}
  `;
  const aggregate = rows[0];
  const count = Number(aggregate?.game_count ?? 0);
  if (count === 0) {
    await tx`DELETE FROM events WHERE name = ${eventName}`;
    return;
  }

  await tx`
    UPDATE events
    SET site = ${aggregate.site},
        date_start = ${aggregate.date_start},
        date_end = ${aggregate.date_end},
        game_count = ${count},
        avg_elo = ${aggregate.avg_elo},
        updated_at = NOW()
    WHERE name = ${eventName}
  `;
}

function resultForPlayer(result: string, isWhite: boolean): RecentGame["result"] {
  if (result === "1/2-1/2") return "Draw";
  if ((isWhite && result === "1-0") || (!isWhite && result === "0-1")) return "Won";
  return "Lost";
}

function formatDate(date: Date | string): string {
  if (typeof date === "string") return date.replace(/-/g, ".");
  return date.toISOString().slice(0, 10).replace(/-/g, ".");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

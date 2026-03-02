import type { MetadataRoute } from "next";
import {
  getPlayerCount,
  getGameCount,
  getPlayerSlugsForSitemap,
  getGameSlugsForSitemap,
} from "@/lib/db";

const BASE_URL = "https://outprep.xyz";
const ENTRIES_PER_SITEMAP = 45000; // Stay under 50K limit

/**
 * Generate sitemap IDs:
 * - ID 0: static pages
 * - IDs 1..P: player pages in chunks of 45,000
 * - IDs P+1..P+G: game pages in chunks of 45,000
 */
export async function generateSitemaps() {
  const [playerCount, gameCount] = await Promise.all([
    getPlayerCount(),
    getGameCount(),
  ]);

  const playerSitemapCount = Math.max(
    1,
    Math.ceil(playerCount / ENTRIES_PER_SITEMAP),
  );
  const gameSitemapCount = Math.max(
    1,
    Math.ceil(gameCount / ENTRIES_PER_SITEMAP),
  );

  return Array.from(
    { length: 1 + playerSitemapCount + gameSitemapCount },
    (_, i) => ({ id: i }),
  );
}

export default async function sitemap({
  id,
}: {
  id: number;
}): Promise<MetadataRoute.Sitemap> {
  // Sitemap 0: static pages
  if (id === 0) {
    return [
      {
        url: BASE_URL,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 1.0,
      },
    ];
  }

  const playerCount = await getPlayerCount();
  const playerSitemapCount = Math.max(
    1,
    Math.ceil(playerCount / ENTRIES_PER_SITEMAP),
  );

  // Sitemaps 1..P: player pages
  if (id <= playerSitemapCount) {
    const offset = (id - 1) * ENTRIES_PER_SITEMAP;
    const players = await getPlayerSlugsForSitemap(offset, ENTRIES_PER_SITEMAP);

    return players.map((p) => ({
      url: `${BASE_URL}/player/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority:
        p.fideRating >= 2500 ? 0.9 : p.fideRating >= 2000 ? 0.7 : 0.5,
    }));
  }

  // Sitemaps P+1..end: game pages
  const gameIdx = id - playerSitemapCount - 1;
  const offset = gameIdx * ENTRIES_PER_SITEMAP;
  const games = await getGameSlugsForSitemap(offset, ENTRIES_PER_SITEMAP);

  return games.map((g) => ({
    url: `${BASE_URL}/game/${g.slug}`,
    lastModified: g.date,
    changeFrequency: "monthly" as const,
    priority: g.avgElo >= 2500 ? 0.7 : 0.5,
  }));
}

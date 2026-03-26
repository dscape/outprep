import type { MetadataRoute } from "next";
import {
  getPlayerCount,
  getGameCount,
  getEventCount,
  getPlayerSlugsForSitemap,
  getGameSlugsForSitemap,
  getEventSlugsForSitemap,
} from "@/lib/db";

export const revalidate = 86400; // ISR: cache for 24 hours

const BASE_URL = "https://outprep.xyz";
const ENTRIES_PER_SITEMAP = 5000; // Smaller chunks = faster generation, stays well under 50K limit

/**
 * Generate sitemap IDs:
 * - ID 0: static pages + event pages (events are few enough to fit in one sitemap)
 * - IDs 1..P: player pages in chunks of 5,000
 * - IDs P+1..P+G: game pages in chunks of 5,000
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

export default async function sitemap(
  // Next.js 16 passes id as a Promise<string> (async dynamic params)
  props: { id: number },
): Promise<MetadataRoute.Sitemap> {
  const id = Number(await (props as Record<string, unknown>).id);
  // Sitemap 0: static pages + event pages
  if (id === 0) {
    const staticPages: MetadataRoute.Sitemap = [
      {
        url: BASE_URL,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 1.0,
      },
    ];

    // Events fit in the static sitemap (typically hundreds, not millions)
    const eventCount = await getEventCount();
    if (eventCount > 0) {
      const events = await getEventSlugsForSitemap(0, eventCount);
      for (const e of events) {
        staticPages.push({
          url: `${BASE_URL}/event/${e.slug}`,
          lastModified: e.updatedAt,
          changeFrequency: "weekly",
          priority: e.gameCount >= 50 ? 0.8 : 0.6,
        });
      }
    }

    return staticPages;
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

import type { MetadataRoute } from "next";
import { getPlayerIndex, getGameIndex } from "@/lib/fide-blob";

const BASE_URL = "https://outprep.xyz";
const GAMES_PER_SITEMAP = 45000; // Stay under 50K limit

/**
 * Generate sitemap IDs:
 * - ID 0: static pages + player pages
 * - IDs 1..N: game pages in chunks of 45,000
 */
export async function generateSitemaps() {
  const gameIndex = await getGameIndex();
  const totalGames = gameIndex?.totalGames ?? 0;
  const gameSitemapCount = Math.max(1, Math.ceil(totalGames / GAMES_PER_SITEMAP));

  return [
    { id: 0 },
    ...Array.from({ length: gameSitemapCount }, (_, i) => ({ id: i + 1 })),
  ];
}

export default async function sitemap({
  id,
}: {
  id: number;
}): Promise<MetadataRoute.Sitemap> {
  // Sitemap 0: static pages + player pages
  if (id === 0) {
    const entries: MetadataRoute.Sitemap = [
      {
        url: BASE_URL,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 1.0,
      },
    ];

    const index = await getPlayerIndex();
    if (index) {
      for (const p of index.players) {
        entries.push({
          url: `${BASE_URL}/player/${p.slug}`,
          lastModified: new Date(index.generatedAt),
          changeFrequency: "weekly",
          priority:
            p.fideRating >= 2500 ? 0.9 : p.fideRating >= 2000 ? 0.7 : 0.5,
        });
      }
    }

    return entries;
  }

  // Sitemaps 1..N: game pages
  const gameIndex = await getGameIndex();
  if (!gameIndex) return [];

  const start = (id - 1) * GAMES_PER_SITEMAP;
  const chunk = gameIndex.games.slice(start, start + GAMES_PER_SITEMAP);

  return chunk.map((g) => ({
    url: `${BASE_URL}/game/${g.slug}`,
    lastModified: new Date(gameIndex.generatedAt),
    changeFrequency: "monthly" as const,
    priority:
      (g.whiteElo + g.blackElo) / 2 >= 2500 ? 0.7 : 0.5,
  }));
}

import type { MetadataRoute } from "next";
import { getPlayerIndex } from "@/lib/fide-blob";

const BASE_URL = "https://outprep.xyz";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
  ];

  const index = await getPlayerIndex();
  if (!index) return entries;

  for (const p of index.players) {
    entries.push({
      url: `${BASE_URL}/player/${p.slug}`,
      lastModified: new Date(index.generatedAt),
      changeFrequency: "weekly",
      priority:
        p.fideRating >= 2500 ? 0.9 : p.fideRating >= 2000 ? 0.7 : 0.5,
    });
  }

  return entries;
}

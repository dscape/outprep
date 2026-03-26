import { getPlayerCount, getGameCount } from "@/lib/db";

export const revalidate = 86400;

const BASE_URL = "https://outprep.xyz";
const ENTRIES_PER_SITEMAP = 5000;

export async function GET() {
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

  const totalSitemaps = 1 + playerSitemapCount + gameSitemapCount;

  const entries = Array.from({ length: totalSitemaps }, (_, i) =>
    `  <sitemap><loc>${BASE_URL}/sitemap/${i}.xml</loc></sitemap>`,
  ).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}

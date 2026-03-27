import {
  getPlayerCount,
  getGameCount,
  getEventCount,
  getPlayerSlugsForSitemap,
  getGameSlugsForSitemap,
  getEventSlugsForSitemap,
} from "@/lib/db";

const BASE_URL = "https://outprep.xyz";
const ENTRIES_PER_SITEMAP = 5000;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = Number(rawId.replace(".xml", ""));

  if (isNaN(id) || id < 0) {
    return new Response("Not Found", { status: 404 });
  }

  const entries = await generateSitemapEntries(id);

  if (entries === null) {
    return new Response("Not Found", { status: 404 });
  }

  const urls = entries
    .map(
      (e) =>
        `<url><loc>${escapeXml(e.url)}</loc><lastmod>${e.lastModified.toISOString()}</lastmod><changefreq>${e.changeFrequency}</changefreq><priority>${e.priority}</priority></url>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}

interface SitemapEntry {
  url: string;
  lastModified: Date;
  changeFrequency: string;
  priority: number;
}

async function generateSitemapEntries(
  id: number,
): Promise<SitemapEntry[] | null> {
  // Sitemap 0: static pages + event pages
  if (id === 0) {
    const entries: SitemapEntry[] = [
      {
        url: BASE_URL,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 1.0,
      },
    ];

    const eventCount = await getEventCount();
    if (eventCount > 0) {
      const events = await getEventSlugsForSitemap(0, eventCount);
      for (const e of events) {
        entries.push({
          url: `${BASE_URL}/event/${e.slug}`,
          lastModified: e.updatedAt,
          changeFrequency: "weekly",
          priority: e.gameCount >= 50 ? 0.8 : 0.6,
        });
      }
    }

    return entries;
  }

  // Fetch counts (fast)
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

  // Out of range check
  if (id > playerSitemapCount + gameSitemapCount) {
    return null;
  }

  // Sitemaps 1..P: player pages
  if (id <= playerSitemapCount) {
    const offset = (id - 1) * ENTRIES_PER_SITEMAP;
    const players = await getPlayerSlugsForSitemap(offset, ENTRIES_PER_SITEMAP);

    return players.map((p) => ({
      url: `${BASE_URL}/player/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly",
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
    changeFrequency: "monthly",
    priority: g.avgElo >= 2500 ? 0.7 : 0.5,
  }));
}

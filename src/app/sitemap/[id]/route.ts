import {
  getRecentEvents,
  getTopPlayerSlugsForSitemap,
} from "@/lib/db";

const BASE_URL = "https://outprep.xyz";

// Keep the public sitemap intentionally small. The full archive contains
// millions of game URLs; advertising them caused crawlers to trigger expensive
// on-demand ISR generation without producing meaningful indexing.
const TOP_PLAYERS_PER_SITEMAP = 500;
const RECENT_EVENTS_PER_SITEMAP = 200;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = Number(rawId.replace(".xml", ""));

  if (id !== 0) {
    return new Response("Gone", {
      status: 410,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  const entries = await generateSitemapEntries();
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

async function generateSitemapEntries(): Promise<SitemapEntry[]> {
  const now = new Date();
  const entries: SitemapEntry[] = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
  ];

  const [events, players] = await Promise.all([
    getRecentEvents(RECENT_EVENTS_PER_SITEMAP),
    getTopPlayerSlugsForSitemap(TOP_PLAYERS_PER_SITEMAP),
  ]);

  for (const event of events) {
    entries.push({
      url: `${BASE_URL}/event/${event.slug}`,
      lastModified: event.dateEnd
        ? new Date(event.dateEnd.replace(/\./g, "-"))
        : now,
      changeFrequency: "weekly",
      priority: event.gameCount >= 50 ? 0.8 : 0.6,
    });
  }

  for (const player of players) {
    entries.push({
      url: `${BASE_URL}/player/${player.slug}`,
      lastModified: player.updatedAt,
      changeFrequency: "weekly",
      priority:
        player.fideRating >= 2500 ? 0.9 : player.fideRating >= 2000 ? 0.7 : 0.5,
    });
  }

  return entries;
}

import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEvent, getEventMeta, formatPlayerName } from "@/lib/db";
import { TitleBadge } from "@/components/title-badge";
import { CountryFlag } from "@/components/country-flag";

export const revalidate = 604800; // 7 days
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

function formatDate(date: string): string {
  const [y, m, d] = date.split(".");
  if (!y || !m || !d) return date;
  const dt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function resultLabel(result: string): { text: string; color: string } {
  switch (result) {
    case "1-0":
      return { text: "1-0", color: "text-green-400" };
    case "0-1":
      return { text: "0-1", color: "text-green-400" };
    case "1/2-1/2":
      return { text: "½-½", color: "text-zinc-400" };
    default:
      return { text: result, color: "text-zinc-400" };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventMeta(slug);
  if (!event) {
    return { title: "Event Not Found" };
  }

  const dateRange = event.dateStart && event.dateEnd
    ? event.dateStart === event.dateEnd
      ? formatDate(event.dateStart)
      : `${formatDate(event.dateStart)} – ${formatDate(event.dateEnd)}`
    : event.dateEnd
      ? formatDate(event.dateEnd)
      : "";

  const description = `${event.gameCount} games${event.avgElo ? ` (avg rating ${event.avgElo})` : ""}${dateRange ? `. ${dateRange}` : ""}${event.site ? `. ${event.site}` : ""}. Browse all games, players, and results.`;

  return {
    title: `${event.name} - Chess Tournament`,
    description,
    alternates: { canonical: `https://outprep.xyz/event/${slug}` },
    openGraph: {
      title: event.name,
      description,
      type: "website",
      url: `https://outprep.xyz/event/${slug}`,
      siteName: "outprep",
    },
    twitter: {
      card: "summary",
      title: event.name,
      description,
    },
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEvent(slug);

  if (!event) {
    notFound();
  }

  const dateRange = event.dateStart && event.dateEnd
    ? event.dateStart === event.dateEnd
      ? formatDate(event.dateStart)
      : `${formatDate(event.dateStart)} – ${formatDate(event.dateEnd)}`
    : event.dateEnd
      ? formatDate(event.dateEnd)
      : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SportsEvent",
        name: event.name,
        sport: "Chess",
        ...(event.dateStart ? { startDate: event.dateStart.replace(/\./g, "-") } : {}),
        ...(event.dateEnd ? { endDate: event.dateEnd.replace(/\./g, "-") } : {}),
        ...(event.site ? { location: { "@type": "Place", name: event.site } } : {}),
        description: `Chess tournament with ${event.gameCount} games${event.avgElo ? `, average rating ${event.avgElo}` : ""}`,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: "https://outprep.xyz",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: event.name,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-4xl">
          <nav className="mb-6 flex items-center gap-2 text-sm text-zinc-500">
            <Link
              href="/"
              className="hover:text-zinc-300 transition-colors"
            >
              Home
            </Link>
            <span>/</span>
            <span className="text-zinc-400 truncate">{event.name}</span>
          </nav>

          {/* Event Header */}
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
            <h1 className="text-2xl font-bold text-white">{event.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
              {dateRange && <span>{dateRange}</span>}
              {event.site && (
                <>
                  {dateRange && <span className="text-zinc-600">·</span>}
                  <span>{event.site}</span>
                </>
              )}
            </div>

            <div className="mt-4 flex gap-4">
              <div className="rounded-lg bg-zinc-900/50 px-4 py-2 text-center">
                <div className="text-lg font-bold text-white">{event.gameCount}</div>
                <div className="text-xs text-zinc-500">Games</div>
              </div>
              <div className="rounded-lg bg-zinc-900/50 px-4 py-2 text-center">
                <div className="text-lg font-bold text-white">{event.players.length}</div>
                <div className="text-xs text-zinc-500">Players</div>
              </div>
              {event.avgElo && (
                <div className="rounded-lg bg-zinc-900/50 px-4 py-2 text-center">
                  <div className="text-lg font-bold text-green-400">{event.avgElo}</div>
                  <div className="text-xs text-zinc-500">Avg Rating</div>
                </div>
              )}
            </div>
          </div>

          {/* Games */}
          {event.games.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-white mb-4">Games</h2>
              <div className="space-y-2">
                {event.games.map((g) => {
                  const result = resultLabel(g.result);
                  return (
                    <Link
                      key={g.slug}
                      href={`/game/${g.slug}`}
                      className="flex items-center gap-3 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-4 py-3 hover:bg-zinc-800/50 hover:border-zinc-700/50 transition-all text-sm group"
                    >
                      {g.round && (
                        <span className="text-zinc-600 text-xs w-8 shrink-0">
                          R{g.round}
                        </span>
                      )}
                      <span className="text-zinc-300 group-hover:text-white transition-colors truncate">
                        {g.whiteTitle && (
                          <span className="text-amber-400/80 mr-1">{g.whiteTitle}</span>
                        )}
                        {formatPlayerName(g.whiteName)}
                        <span className="text-zinc-500 mx-1">({g.whiteElo})</span>
                      </span>
                      <span className={`font-mono font-medium ${result.color} shrink-0`}>
                        {result.text}
                      </span>
                      <span className="text-zinc-300 group-hover:text-white transition-colors truncate">
                        {g.blackTitle && (
                          <span className="text-amber-400/80 mr-1">{g.blackTitle}</span>
                        )}
                        {formatPlayerName(g.blackName)}
                        <span className="text-zinc-500 mx-1">({g.blackElo})</span>
                      </span>
                      {g.opening && (
                        <span className="text-zinc-500 hidden md:inline truncate max-w-[160px] ml-auto">
                          {g.eco && <span className="font-mono mr-1">{g.eco}</span>}
                          {g.opening}
                        </span>
                      )}
                      <span className="text-zinc-600 group-hover:text-zinc-400 shrink-0">&rarr;</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Players */}
          {event.players.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-white mb-4">Players</h2>
              <div className="flex flex-wrap gap-2">
                {event.players.map((p) => (
                  <Link
                    key={p.slug}
                    href={`/player/${p.slug}`}
                    className="rounded-md border border-zinc-800/50 bg-zinc-900/30 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:border-zinc-700/50 transition-all flex items-center gap-2"
                  >
                    {p.federation && <CountryFlag federation={p.federation} />}
                    {p.title && <TitleBadge title={p.title} />}
                    <span>{formatPlayerName(p.name)}</span>
                    <span className="text-zinc-600">({p.fideRating})</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

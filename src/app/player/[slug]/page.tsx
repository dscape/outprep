import { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  getPlayer,
  getPlayerIndex,
  getPlayerGames,
  getAliasTarget,
  formatPlayerName,
} from "@/lib/fide-blob";
import type { FIDEPlayer, OpeningStats } from "@/lib/fide-blob";
import PracticeLoader from "./practice-loader";

export const revalidate = 604800; // 7 days
export const dynamicParams = true;

// Pre-render top 500 players at build time
export async function generateStaticParams() {
  const index = await getPlayerIndex();
  if (!index) return [];

  return index.players
    .slice(0, 500)
    .map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const player = await getPlayer(slug);
  if (!player) {
    return { title: "Player Not Found" };
  }

  const name = formatPlayerName(player.name);
  const titleBadge = player.title ? `${player.title} ` : "";

  // Build rating summary for SEO
  const ratings: string[] = [];
  if (player.standardRating) ratings.push(`Standard ${player.standardRating}`);
  if (player.rapidRating) ratings.push(`Rapid ${player.rapidRating}`);
  if (player.blitzRating) ratings.push(`Blitz ${player.blitzRating}`);
  const ratingSummary = ratings.length > 0 ? ratings.join(" · ") : `FIDE ${player.fideRating}`;
  const federationTag = player.federation ? ` (${player.federation})` : "";

  const description = `Prepare against ${titleBadge}${name}${federationTag}. ${ratingSummary}. Study their openings and practice against an AI trained on ${player.gameCount} OTB games.`;

  return {
    title: `${name} (${titleBadge}${player.fideRating}) - Chess Preparation`,
    description,
    alternates: { canonical: `https://outprep.xyz/player/${slug}` },
    openGraph: {
      title: `Prepare Against ${name}`,
      description: `${titleBadge}${ratingSummary} | ${player.gameCount} games analyzed`,
      type: "profile",
      url: `https://outprep.xyz/player/${slug}`,
      siteName: "outprep",
    },
    twitter: {
      card: "summary",
      title: `Prepare Against ${name}`,
      description: `${titleBadge}${ratingSummary} | ${player.gameCount} games analyzed`,
    },
  };
}

function TitleBadge({ title }: { title: string }) {
  const colors: Record<string, string> = {
    GM: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    IM: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    FM: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    CM: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    WGM: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    WIM: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    WFM: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
        colors[title] || "bg-zinc-700/50 text-zinc-400 border-zinc-600/30"
      }`}
    >
      {title}
    </span>
  );
}

function OpeningTable({
  title,
  openings,
}: {
  title: string;
  openings: OpeningStats[];
}) {
  if (openings.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-3">
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="text-left py-2 pr-4 font-medium">ECO</th>
              <th className="text-left py-2 pr-4 font-medium">Opening</th>
              <th className="text-right py-2 pr-4 font-medium">Games</th>
              <th className="text-right py-2 pr-4 font-medium">Win</th>
              <th className="text-right py-2 pr-4 font-medium">Draw</th>
              <th className="text-right py-2 font-medium">Loss</th>
            </tr>
          </thead>
          <tbody>
            {openings.map((op) => (
              <tr
                key={op.eco}
                className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
              >
                <td className="py-2 pr-4 font-mono text-zinc-400">
                  {op.eco}
                </td>
                <td className="py-2 pr-4 text-zinc-300">{op.name}</td>
                <td className="py-2 pr-4 text-right text-zinc-400">
                  {op.games}
                </td>
                <td className="py-2 pr-4 text-right text-green-400">
                  {op.winRate}%
                </td>
                <td className="py-2 pr-4 text-right text-zinc-400">
                  {op.drawRate}%
                </td>
                <td className="py-2 text-right text-red-400">
                  {op.lossRate}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let player = await getPlayer(slug);

  if (!player) {
    // Check if this slug is an alias that should redirect to the canonical URL
    const canonicalSlug = await getAliasTarget(slug);
    if (canonicalSlug) {
      permanentRedirect(`/player/${canonicalSlug}`);
    }
    notFound();
  }

  const name = formatPlayerName(player.name);
  const totalResults = player.winRate + player.drawRate + player.lossRate;

  // JSON-LD structured data
  const personDescription = [
    player.title ? `${player.title}` : null,
    player.standardRating ? `Standard ${player.standardRating}` : null,
    player.rapidRating ? `Rapid ${player.rapidRating}` : null,
    player.blitzRating ? `Blitz ${player.blitzRating}` : null,
    !player.standardRating && !player.rapidRating && !player.blitzRating
      ? `FIDE ${player.fideRating}`
      : null,
    player.federation ? `Federation: ${player.federation}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        name: name,
        description: personDescription,
        url: `https://outprep.xyz/player/${slug}`,
        knowsAbout: "Chess",
        ...(player.federation ? { nationality: player.federation } : {}),
        ...(player.birthYear
          ? { birthDate: String(player.birthYear) }
          : {}),
        ...(player.fideId
          ? {
              sameAs: [
                `https://ratings.fide.com/profile/${player.fideId}`,
              ],
            }
          : {}),
      },
      {
        "@type": "WebApplication",
        name: "outprep",
        url: "https://outprep.xyz",
        description:
          "Practice against any chess player with an AI that plays like them",
        applicationCategory: "Game",
        operatingSystem: "Web",
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
        <div className="mx-auto max-w-3xl">
          <a
            href="/"
            className="mb-6 inline-block text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            &larr; Back to search
          </a>

          {/* Hero Section */}
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-white">{name}</h1>
                  {player.title && <TitleBadge title={player.title} />}
                </div>
                <p className="text-sm text-zinc-400 mt-1">
                  {player.federation && (
                    <span className="text-zinc-300 font-medium">{player.federation}</span>
                  )}
                  {player.federation && " · "}
                  {player.gameCount.toLocaleString()} OTB games analyzed
                  {player.fideId && (
                    <>
                      {" · "}
                      <a
                        href={`https://ratings.fide.com/profile/${player.fideId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        FIDE #{player.fideId}
                      </a>
                    </>
                  )}
                </p>
              </div>
              <div className="text-right">
                {(player.standardRating || player.rapidRating || player.blitzRating) ? (
                  <div className="flex gap-4">
                    {player.standardRating && (
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-400">
                          {player.standardRating}
                        </div>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wide">
                          Standard
                        </div>
                      </div>
                    )}
                    {player.rapidRating && (
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-400">
                          {player.rapidRating}
                        </div>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wide">
                          Rapid
                        </div>
                      </div>
                    )}
                    {player.blitzRating && (
                      <div className="text-center">
                        <div className="text-2xl font-bold text-amber-400">
                          {player.blitzRating}
                        </div>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wide">
                          Blitz
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="text-3xl font-bold text-green-400">
                      {player.fideRating}
                    </div>
                    <div className="text-xs text-zinc-500 uppercase tracking-wide">
                      FIDE Rating
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Performance Stats */}
            {totalResults > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-3">
                  Performance
                </h3>
                <div className="flex gap-4">
                  <div className="flex-1 rounded-lg bg-zinc-900/50 p-3 text-center">
                    <div className="text-lg font-bold text-green-400">
                      {player.winRate}%
                    </div>
                    <div className="text-xs text-zinc-500">Wins</div>
                  </div>
                  <div className="flex-1 rounded-lg bg-zinc-900/50 p-3 text-center">
                    <div className="text-lg font-bold text-zinc-300">
                      {player.drawRate}%
                    </div>
                    <div className="text-xs text-zinc-500">Draws</div>
                  </div>
                  <div className="flex-1 rounded-lg bg-zinc-900/50 p-3 text-center">
                    <div className="text-lg font-bold text-red-400">
                      {player.lossRate}%
                    </div>
                    <div className="text-xs text-zinc-500">Losses</div>
                  </div>
                </div>
              </div>
            )}

            {/* Recent Events */}
            {player.recentEvents.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-2">
                  Recent Events
                </h3>
                <div className="flex flex-wrap gap-2">
                  {player.recentEvents.map((event) => (
                    <span
                      key={event}
                      className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400"
                    >
                      {event}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Opening Repertoire */}
          <div className="mt-8 space-y-8">
            <h2 className="text-lg font-semibold text-white">
              Opening Repertoire
            </h2>
            <OpeningTable
              title="As White"
              openings={player.openings.white}
            />
            <OpeningTable
              title="As Black"
              openings={player.openings.black}
            />
            {player.openings.white.length === 0 &&
              player.openings.black.length === 0 && (
                <p className="text-sm text-zinc-500">
                  Not enough games to build an opening repertoire yet.
                </p>
              )}
          </div>

          {/* Practice CTA */}
          <div className="mt-10 flex flex-col items-center gap-3 pb-8">
            <PracticeLoader
              slug={slug}
              playerName={name}
            />
            <p className="text-xs text-zinc-500 text-center max-w-md">
              Our AI analyzes {name}&apos;s OTB games and creates a bot that
              plays like them. Practice openings, exploit weaknesses, and
              prepare for your next tournament encounter.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

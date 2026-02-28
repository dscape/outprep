import { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  getPlayer,
  getPlayerIndex,
  getAliasTarget,
  formatPlayerName,
} from "@/lib/fide-blob";
import type { FIDEPlayer } from "@/lib/fide-blob";
import { TitleBadge } from "@/components/title-badge";
import PracticeLoader from "./practice-loader";
import FideOpenings from "./fide-openings";

export const revalidate = 604800; // 7 days
export const dynamicParams = true;

// Pre-render all player pages at build time
export async function generateStaticParams() {
  const index = await getPlayerIndex();
  if (!index) return [];

  return index.players.map((p) => ({ slug: p.slug }));
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

function GameList({
  games,
  title,
}: {
  games?: FIDEPlayer["recentGames"];
  title: string;
}) {
  if (!games || games.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-white mb-4">{title}</h2>
      <div className="space-y-2">
        {games.map((g) => {
          const resultColor =
            g.result === "Won"
              ? "text-green-400"
              : g.result === "Lost"
                ? "text-red-400"
                : "text-zinc-400";

          // Format date: "2022.04.20" → "Apr 2022"
          const [y, m] = g.date.split(".");
          const dateLabel = y && m
            ? new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })
            : g.date;

          return (
            <a
              key={g.slug}
              href={`/game/${g.slug}`}
              className="flex items-center gap-3 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-4 py-3 hover:bg-zinc-800/50 hover:border-zinc-700/50 transition-all text-sm group"
            >
              <span className={`font-medium ${resultColor} w-10`}>{g.result}</span>
              <span className="text-zinc-300 group-hover:text-white transition-colors flex-1 truncate">
                vs {formatPlayerName(g.opponentName)} ({g.opponentElo})
              </span>
              {g.opening && (
                <span className="text-zinc-500 hidden sm:inline truncate max-w-[140px]">
                  {g.opening}
                </span>
              )}
              <span className="text-zinc-600 text-xs whitespace-nowrap">{dateLabel}</span>
              <span className="text-zinc-600 group-hover:text-zinc-400">&rarr;</span>
            </a>
          );
        })}
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
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-white mb-4">
              Opening Repertoire
            </h2>
            <FideOpenings
              white={player.openings.white}
              black={player.openings.black}
              playerSlug={slug}
              playerName={name}
            />
          </div>

          {/* Notable Games */}
          <GameList games={player.notableGames} title="Notable Games" />

          {/* Recent Games */}
          <GameList games={player.recentGames} title="Recent Games" />

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

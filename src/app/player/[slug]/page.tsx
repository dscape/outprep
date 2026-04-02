import { Suspense } from "react";
import { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import {
  getPlayer,
  getAliasTarget,
  getOnlineProfile,
  getTopPlayers,
  formatPlayerName,
  generateEventSlug,
} from "@/lib/db";
import type { FIDEPlayer } from "@/lib/db";
import type { PlayerProfile, PlayerRatings } from "@/lib/types";
import { parsePlatformUsername } from "@/lib/platform-utils";
import PlayerCard from "@/components/PlayerCard";
import { ScoutProvider } from "./scout-context";
import SpeedFilter from "./speed-filter";
import TimeRangeFilter from "./time-range-filter";
import PracticeButton from "./practice-button";
import PlayerCardHydrator from "./player-card-hydrator";
import ErrorProfileSection from "./error-profile-section";
import ScoutTabs from "./scout-tabs";
import UpgradeProgressBar from "./upgrade-progress-bar";
import ScoutLoading from "./scout-loading";

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const players = await getTopPlayers(10);
  return players.map((p) => ({ slug: p.slug }));
}

function mapChessTitle(abbr: string | null): string | undefined {
  if (!abbr) return undefined;
  const map: Record<string, string> = {
    GM: "Chess Grandmaster", IM: "Chess International Master",
    FM: "Chess FIDE Master", CM: "Chess Candidate Master",
    WGM: "Chess Woman Grandmaster", WIM: "Chess Woman International Master",
    WFM: "Chess Woman FIDE Master", WCM: "Chess Woman Candidate Master",
  };
  return map[abbr] ?? "Chess Player";
}

function parseSlug(slug: string): { platform: "fide" | "lichess" | "chesscom" | "pgn"; username: string } {
  const decoded = decodeURIComponent(slug);
  const { platform, username } = parsePlatformUsername(decoded);
  if (!decoded.includes(":")) {
    return { platform: "fide", username: decoded };
  }
  return { platform, username };
}

async function resolvePlayerMeta(slug: string, platform: string, username: string) {
  if (platform === "fide") {
    const player = await getPlayer(slug);
    if (!player) return null;

    const name = formatPlayerName(player.name);
    const titleBadge = player.title ? `${player.title} ` : "";
    const ratings: string[] = [];
    if (player.standardRating) ratings.push(`Standard ${player.standardRating}`);
    if (player.rapidRating) ratings.push(`Rapid ${player.rapidRating}`);
    if (player.blitzRating) ratings.push(`Blitz ${player.blitzRating}`);
    const ratingSummary = ratings.length > 0 ? ratings.join(" · ") : `FIDE ${player.fideRating}`;
    const federationTag = player.federation ? ` (${player.federation})` : "";

    return {
      title: `${name} (${titleBadge}${player.fideRating}) - Chess Preparation`,
      description: `Prepare against ${titleBadge}${name}${federationTag}. ${ratingSummary}. Study their openings and practice against an AI trained on ${player.gameCount} OTB games.`,
      ogTitle: `Prepare Against ${name}`,
      ogDescription: `${titleBadge}${ratingSummary} | ${player.gameCount} games analyzed`,
      ogType: "profile" as const,
    };
  }

  if (platform === "lichess" || platform === "chesscom") {
    const platformLabel = platform === "chesscom" ? "Chess.com" : "Lichess";
    const cached = await getOnlineProfile(platform, username);
    const profile = cached?.profileJson as PlayerProfile | null;
    const displayName = profile?.username || username;

    const ratingParts: string[] = [];
    if (profile?.ratings) {
      for (const [speed, rating] of Object.entries(profile.ratings)) {
        if (rating) ratingParts.push(`${speed.charAt(0).toUpperCase() + speed.slice(1)} ${rating}`);
      }
    }
    const ratingSummary = ratingParts.join(" · ");
    const gameCount = profile?.analyzedGames || cached?.gameCount || 0;
    const gamesSuffix = gameCount ? ` from ${gameCount} games` : "";

    return {
      title: `${displayName} - ${platformLabel} Scouting Report`,
      description: `Scouting report for ${displayName}. ${ratingSummary}${ratingSummary ? ". " : ""}Openings, weaknesses, playing style, and preparation tips${gamesSuffix}.`,
      ogTitle: `${displayName} - Scouting Report`,
      ogDescription: `Study ${displayName}'s openings, weaknesses, and playing style.${ratingSummary ? ` ${ratingSummary}` : ""}`,
    };
  }

  return {
    title: `${username} - Chess Scouting Report`,
    description: `Scouting report for ${username}. Openings, weaknesses, playing style, and preparation tips.`,
    ogTitle: `${username} - Scouting Report`,
    ogDescription: `Study ${username}'s openings, weaknesses, and playing style.`,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { platform, username } = parseSlug(slug);
  const meta = await resolvePlayerMeta(slug, platform, username);

  if (!meta) return { title: "Player Not Found" };

  const canonical = `https://outprep.xyz/player/${slug}`;

  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical },
    openGraph: {
      title: meta.ogTitle,
      description: meta.ogDescription,
      ...(meta.ogType ? { type: meta.ogType } : {}),
      url: canonical,
      siteName: "outprep",
    },
    twitter: {
      card: "summary_large_image",
      title: meta.ogTitle,
      description: meta.ogDescription,
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

          const [y, m] = g.date.split(".");
          const dateLabel = y && m
            ? new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })
            : g.date;

          return (
            <Link
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
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Build a partial PlayerProfile from FIDEPlayer data for SSR rendering. */
function fidePlayerToProfile(player: FIDEPlayer): PlayerProfile {
  const ratings: PlayerRatings = {};
  if (player.standardRating) ratings.classical = player.standardRating;
  if (player.rapidRating) ratings.rapid = player.rapidRating;
  if (player.blitzRating) ratings.blitz = player.blitzRating;

  return {
    username: formatPlayerName(player.name),
    platform: "fide",
    totalGames: player.gameCount,
    analyzedGames: player.gameCount,
    ratings,
    style: { aggression: 0, tactical: 0, positional: 0, endgame: 0, sampleSize: 0 },
    weaknesses: [],
    openings: player.openings,
    prepTips: [],
    lastComputed: 0,
  };
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { platform, username } = parseSlug(slug);

  // ─── Resolve SSR data ──────────────────────────────────────────────────
  let fidePlayer: FIDEPlayer | null = null;
  let ssrProfile: PlayerProfile | null = null;
  let cachedProfile: PlayerProfile | null = null;

  if (platform === "fide") {
    fidePlayer = await getPlayer(slug);
    if (!fidePlayer) {
      const canonicalSlug = await getAliasTarget(slug);
      if (canonicalSlug) permanentRedirect(`/player/${canonicalSlug}`);
      notFound();
    }
    ssrProfile = fidePlayerToProfile(fidePlayer);
  } else if (platform === "lichess" || platform === "chesscom") {
    const cached = await getOnlineProfile(platform, username);
    cachedProfile = (cached?.profileJson as PlayerProfile) || null;
    ssrProfile = cachedProfile;
  }

  const displayName = ssrProfile?.username || username;
  const scoutUsername = platform === "fide" ? slug : username;

  // ─── FIDE JSON-LD ─────────────────────────────────────────────────────
  const jsonLd = fidePlayer ? {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        name: formatPlayerName(fidePlayer.name),
        description: [
          fidePlayer.title,
          fidePlayer.standardRating ? `Standard ${fidePlayer.standardRating}` : null,
          fidePlayer.rapidRating ? `Rapid ${fidePlayer.rapidRating}` : null,
          fidePlayer.blitzRating ? `Blitz ${fidePlayer.blitzRating}` : null,
          !fidePlayer.standardRating && !fidePlayer.rapidRating && !fidePlayer.blitzRating
            ? `FIDE ${fidePlayer.fideRating}` : null,
          fidePlayer.federation ? `Federation: ${fidePlayer.federation}` : null,
        ].filter(Boolean).join(", "),
        url: `https://outprep.xyz/player/${slug}`,
        image: `https://outprep.xyz/player/${slug}/opengraph-image`,
        knowsAbout: "Chess",
        ...(mapChessTitle(fidePlayer.title) ? { jobTitle: mapChessTitle(fidePlayer.title) } : {}),
        hasOccupation: {
          "@type": "Occupation",
          name: "Chess Player",
        },
        ...(fidePlayer.federation ? {
          nationality: fidePlayer.federation,
          memberOf: {
            "@type": "SportsOrganization",
            name: `${fidePlayer.federation} Chess Federation`,
          },
        } : {}),
        affiliation: {
          "@type": "Organization",
          name: "FIDE",
          url: "https://www.fide.com",
        },
        ...(fidePlayer.birthYear ? { birthDate: String(fidePlayer.birthYear) } : {}),
        ...(fidePlayer.fideId ? { sameAs: [`https://ratings.fide.com/profile/${fidePlayer.fideId}`] } : {}),
      },
      {
        "@type": "WebApplication",
        name: "outprep",
        url: "https://outprep.xyz",
        description: "Practice against any chess player with an AI that plays like them",
        applicationCategory: "Game",
        operatingSystem: "Web",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://outprep.xyz" },
          { "@type": "ListItem", position: 2, name: formatPlayerName(fidePlayer.name) },
        ],
      },
    ],
  } : null;

  // ─── FIDE-specific extras for PlayerCard ───────────────────────────────
  const fideExtras = fidePlayer ? {
    title: fidePlayer.title,
    federation: fidePlayer.federation,
    fideId: fidePlayer.fideId,
    winRate: fidePlayer.winRate,
    drawRate: fidePlayer.drawRate,
    lossRate: fidePlayer.lossRate,
    recentEvents: fidePlayer.recentEvents,
    eventSlugs: Object.fromEntries(
      fidePlayer.recentEvents.map((e) => [e, generateEventSlug(e)])
    ),
  } : {};

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}

      <div className="min-h-screen px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <ScoutProvider platform={platform} username={scoutUsername}>
          <div className="mb-6 flex items-center justify-between">
            <Link
              href="/"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              &larr; Back to search
            </Link>
            <PracticeButton playerName={displayName} slug={scoutUsername} platform={platform} fideRating={fidePlayer?.fideRating} />
          </div>
            {/* Loading / Error states */}
            <ScoutLoading />

            {/* Filters — lazy loaded, not SSR */}
            <Suspense fallback={null}>
              <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                <SpeedFilter />
                <TimeRangeFilter />
              </div>
            </Suspense>

            {/* Player Card — SSR with partial data, hydrates with full profile */}
            <PlayerCardHydrator {...fideExtras}>
              {ssrProfile ? (
                <PlayerCard
                  profile={ssrProfile}
                  hero
                  {...fideExtras}
                />
              ) : (
                <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
                  <h1 className="text-2xl font-bold text-white">{username}</h1>
                  <p className="text-sm text-zinc-500 mt-1">
                    {platform === "pgn" ? "PGN Upload" : `${platform === "chesscom" ? "Chess.com" : "Lichess"} · Loading profile...`}
                  </p>
                </div>
              )}
            </PlayerCardHydrator>

            {/* Error Profile */}
            <ErrorProfileSection />

            {/* Upgrade Progress Bar */}
            <UpgradeProgressBar />

            {/* Tabs (openings SSR for FIDE, weaknesses/prep lazy) */}
            <ScoutTabs
              ssrOpenings={fidePlayer ? fidePlayer.openings : undefined}
              playerSlug={fidePlayer ? slug : undefined}
              playerName={fidePlayer ? displayName : undefined}
              playerFideId={fidePlayer?.fideId}
            />

          </ScoutProvider>

          {/* FIDE-only: Notable & Recent Games (SSR) */}
          {fidePlayer && (
            <>
              <GameList games={fidePlayer.notableGames} title="Notable Games" />
              <GameList games={fidePlayer.recentGames} title="Recent Games" />
            </>
          )}
        </div>
      </div>
    </>
  );
}

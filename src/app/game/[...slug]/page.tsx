import { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  getGame,
  getGameIndex,
  getGameAliasTarget,
  formatPlayerName,
} from "@/lib/fide-blob";
import { TitleBadge } from "@/components/title-badge";
import GameReplay from "@/components/GameReplay";

export const revalidate = 604800; // 7 days
export const dynamicParams = true;

// Pre-render all game pages at build time
export async function generateStaticParams() {
  const index = await getGameIndex();
  if (!index) return [];

  return index.games.map((g) => ({ slug: g.slug.split("/") }));
}

function formatDate(date: string): string {
  // "2022.04.20" → "Apr 20, 2022"
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
      return { text: "White wins", color: "text-green-400" };
    case "0-1":
      return { text: "Black wins", color: "text-green-400" };
    case "1/2-1/2":
      return { text: "Draw", color: "text-zinc-400" };
    default:
      return { text: result, color: "text-zinc-400" };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug: slugParts } = await params;
  const slug = slugParts.join("/");
  const game = await getGame(slug);
  if (!game) {
    return { title: "Game Not Found" };
  }

  const white = formatPlayerName(game.whiteName);
  const black = formatPlayerName(game.blackName);
  const year = game.date.split(".")[0];
  const openingTag = game.opening
    ? ` | ${game.eco ? game.eco + " " : ""}${game.opening}`
    : game.eco
      ? ` | ${game.eco}`
      : "";

  const wTitle = game.whiteTitle ? `${game.whiteTitle} ` : "";
  const bTitle = game.blackTitle ? `${game.blackTitle} ` : "";
  const resultText = resultLabel(game.result).text;

  const title = `${white} vs ${black} - ${game.event} (${year})${openingTag}`;
  const description = `${wTitle}${white} (${game.whiteElo}) vs ${bTitle}${black} (${game.blackElo}) at ${game.event}${game.round ? `, Round ${game.round}` : ""}. ${game.opening ? `${game.opening}${game.variation ? `: ${game.variation}` : ""} (${game.eco}). ` : ""}${resultText}. Practice against either player on outprep.`;

  return {
    title,
    description,
    alternates: { canonical: `https://outprep.xyz/game/${slug}` },
    openGraph: {
      title: `${white} vs ${black} - ${game.event}`,
      description: `${wTitle}${game.whiteElo} vs ${bTitle}${game.blackElo} | ${resultText}${openingTag}`,
      type: "article",
      url: `https://outprep.xyz/game/${slug}`,
      siteName: "outprep",
    },
    twitter: {
      card: "summary",
      title: `${white} vs ${black} - ${game.event}`,
      description: `${wTitle}${game.whiteElo} vs ${bTitle}${game.blackElo} | ${resultText}${openingTag}`,
    },
  };
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug: slugParts } = await params;
  const slug = slugParts.join("/");
  let game = await getGame(slug);

  if (!game) {
    // Check if this is a legacy slug that should redirect to the new URL
    const canonicalSlug = await getGameAliasTarget(slug);
    if (canonicalSlug) {
      permanentRedirect(`/game/${canonicalSlug}`);
    }
    notFound();
  }

  const white = formatPlayerName(game.whiteName);
  const black = formatPlayerName(game.blackName);
  const result = resultLabel(game.result);

  // JSON-LD structured data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${white} vs ${black} - ${game.event}${game.round ? ` Round ${game.round}` : ""}`,
    sport: "Chess",
    startDate: game.date.replace(/\./g, "-"),
    ...(game.site ? { location: { "@type": "Place", name: game.site } } : {}),
    competitor: [
      {
        "@type": "Person",
        name: white,
        ...(game.whiteSlug
          ? { url: `https://outprep.xyz/player/${game.whiteSlug}` }
          : {}),
      },
      {
        "@type": "Person",
        name: black,
        ...(game.blackSlug
          ? { url: `https://outprep.xyz/player/${game.blackSlug}` }
          : {}),
      },
    ],
    description: `Chess game: ${game.opening ? `${game.opening} (${game.eco})` : game.eco ?? "Unknown opening"}. Result: ${game.result}`,
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

          {/* Players Header */}
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
            <div className="flex items-center justify-between gap-4">
              {/* White */}
              <div className="flex-1 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <div className="h-4 w-4 rounded-sm border border-zinc-600 bg-white" />
                  {game.whiteTitle && <TitleBadge title={game.whiteTitle} />}
                </div>
                {game.whiteSlug ? (
                  <a
                    href={`/player/${game.whiteSlug}`}
                    className="text-lg font-bold text-white hover:text-green-400 transition-colors"
                  >
                    {white}
                  </a>
                ) : (
                  <span className="text-lg font-bold text-white">{white}</span>
                )}
                <div className="text-sm text-zinc-500 mt-0.5">{game.whiteElo}</div>
              </div>

              {/* Result */}
              <div className="text-center px-4">
                <div className={`text-xl font-bold ${result.color}`}>
                  {game.result}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">{result.text}</div>
              </div>

              {/* Black */}
              <div className="flex-1 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <div className="h-4 w-4 rounded-sm border border-zinc-600 bg-zinc-900" />
                  {game.blackTitle && <TitleBadge title={game.blackTitle} />}
                </div>
                {game.blackSlug ? (
                  <a
                    href={`/player/${game.blackSlug}`}
                    className="text-lg font-bold text-white hover:text-green-400 transition-colors"
                  >
                    {black}
                  </a>
                ) : (
                  <span className="text-lg font-bold text-white">{black}</span>
                )}
                <div className="text-sm text-zinc-500 mt-0.5">{game.blackElo}</div>
              </div>
            </div>

            {/* Game Info */}
            <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-zinc-500 text-xs uppercase tracking-wide mb-1">Event</div>
                <div className="text-zinc-300">{game.event}</div>
              </div>
              <div>
                <div className="text-zinc-500 text-xs uppercase tracking-wide mb-1">Date</div>
                <div className="text-zinc-300">{formatDate(game.date)}</div>
              </div>
              {game.site && (
                <div>
                  <div className="text-zinc-500 text-xs uppercase tracking-wide mb-1">Site</div>
                  <div className="text-zinc-300">{game.site}</div>
                </div>
              )}
              {game.round && (
                <div>
                  <div className="text-zinc-500 text-xs uppercase tracking-wide mb-1">Round</div>
                  <div className="text-zinc-300">{game.round}</div>
                </div>
              )}
            </div>

            {/* Opening */}
            {(game.opening || game.eco) && (
              <div className="mt-6 rounded-lg bg-zinc-900/50 p-4">
                <div className="text-zinc-500 text-xs uppercase tracking-wide mb-1">Opening</div>
                <div className="text-zinc-300">
                  {game.eco && (
                    <span className="font-mono text-zinc-400 mr-2">{game.eco}</span>
                  )}
                  {game.opening && <span>{game.opening}</span>}
                  {game.variation && (
                    <span className="text-zinc-500">: {game.variation}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Game Replay + Analysis */}
          {game.pgn && (
            <div className="mt-8">
              <GameReplay
                pgn={game.pgn}
                whiteName={white}
                blackName={black}
              />
            </div>
          )}

          {/* Practice CTAs */}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {game.whiteSlug && (
              <a
                href={`/player/${game.whiteSlug}`}
                className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-4 hover:bg-zinc-800 hover:border-green-500/30 transition-all group"
              >
                <div className="h-3 w-3 rounded-sm border border-zinc-600 bg-white" />
                <span className="text-sm text-zinc-300 group-hover:text-green-400 transition-colors">
                  Practice against {white}
                </span>
                <span className="text-zinc-600 ml-auto">&rarr;</span>
              </a>
            )}
            {game.blackSlug && (
              <a
                href={`/player/${game.blackSlug}`}
                className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-4 hover:bg-zinc-800 hover:border-green-500/30 transition-all group"
              >
                <div className="h-3 w-3 rounded-sm border border-zinc-600 bg-zinc-900" />
                <span className="text-sm text-zinc-300 group-hover:text-green-400 transition-colors">
                  Practice against {black}
                </span>
                <span className="text-zinc-600 ml-auto">&rarr;</span>
              </a>
            )}
          </div>

          <p className="mt-6 text-xs text-zinc-500 text-center max-w-md mx-auto pb-8">
            Our AI analyzes OTB games and creates bots that play like real players.
            Practice openings, exploit weaknesses, and prepare for your next encounter.
          </p>
        </div>
      </div>
    </>
  );
}

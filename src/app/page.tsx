import Link from "next/link";
import SearchInput from "@/components/SearchInput";
import PGNDropZone from "@/components/PGNDropZone";
import { getTopPlayers, getRecentEvents, formatPlayerName } from "@/lib/db";

const faqs = [
  {
    q: "What is outprep?",
    a: "outprep is a free chess preparation tool. Search for any FIDE-rated player to study their opening repertoire, win/draw/loss statistics, and recent tournament games. Then practice against an AI bot trained on their real OTB games.",
  },
  {
    q: "How does the chess AI work?",
    a: "We analyze a player's over-the-board game history to build an opening book and playing style profile. The AI uses this data to mimic their opening choices, tactical tendencies, and positional preferences — giving you realistic preparation for tournament play.",
  },
  {
    q: "Which players can I practice against?",
    a: "Any FIDE-rated player with OTB games in the TWIC (The Week in Chess) database — over 80,000 players. You can also upload your own PGN files or import games from Lichess to scout any opponent.",
  },
  {
    q: "Is outprep free?",
    a: "Yes, outprep is completely free to use. All features — scouting reports, opening analysis, and AI practice — are available at no cost.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: "outprep",
      url: "https://outprep.xyz",
      description:
        "Scout any chess player, study their openings and weaknesses, then practice against a bot that plays like them.",
      applicationCategory: "Game",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
    {
      "@type": "WebSite",
      url: "https://outprep.xyz",
      name: "outprep",
      description: "Chess preparation tool",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "https://outprep.xyz/scout/{username}",
        },
        "query-input": "required name=username",
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: f.a,
        },
      })),
    },
  ],
};

function formatEventDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const [y, m] = dateStr.split(".");
  if (!y || !m) return dateStr;
  return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export default async function Home() {
  const [topPlayers, recentEvents] = await Promise.all([
    getTopPlayers(12),
    getRecentEvents(8),
  ]);

  return (
    <div className="flex flex-col items-center px-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero — fills viewport so content below is below the fold */}
      <div className="flex min-h-screen flex-col items-center justify-center w-full max-w-md text-center">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            outprep
          </h1>
          <p className="mt-3 text-sm text-zinc-400 leading-relaxed max-w-xs mx-auto">
            Scout any chess player. Study their openings and weaknesses.
            Practice against a bot that plays like them.
          </p>
        </div>

        <SearchInput />

        <div className="my-6 flex items-center gap-3 w-full">
          <div className="flex-1 border-t border-zinc-800" />
          <span className="text-sm text-zinc-600">or</span>
          <div className="flex-1 border-t border-zinc-800" />
        </div>

        <PGNDropZone />
      </div>

      {/* How It Works */}
      <section className="w-full max-w-3xl py-16 border-t border-zinc-800/50">
        <h2 className="text-xl font-bold text-white text-center mb-10">
          How It Works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          <div className="text-center">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-2">
              Scout
            </h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Search any chess player to see their opening repertoire,
              performance statistics, and recent tournament games.
            </p>
          </div>
          <div className="text-center">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-2">
              Study
            </h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Analyze their favorite openings, discover weaknesses in their
              play, and build a targeted preparation plan.
            </p>
          </div>
          <div className="text-center">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-2">
              Practice
            </h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Play against an AI that mimics their style — trained on real
              over-the-board games from FIDE-rated tournaments.
            </p>
          </div>
        </div>
      </section>

      {/* Featured Players */}
      {topPlayers.length > 0 && (
        <section className="w-full max-w-3xl py-16 border-t border-zinc-800/50">
          <h2 className="text-xl font-bold text-white text-center mb-2">
            Top Players
          </h2>
          <p className="text-sm text-zinc-500 text-center mb-8">
            Prepare against the world&apos;s strongest chess players
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {topPlayers.map((p) => (
              <a
                key={p.slug}
                href={`/player/${p.slug}`}
                className="rounded-md border border-zinc-800/50 bg-zinc-900/30 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:border-zinc-700/50 transition-all"
              >
                {formatPlayerName(p.name)}
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Recent Events */}
      {recentEvents.length > 0 && (
        <section className="w-full max-w-3xl py-16 border-t border-zinc-800/50">
          <h2 className="text-xl font-bold text-white text-center mb-2">
            Recent Events
          </h2>
          <p className="text-sm text-zinc-500 text-center mb-8">
            Browse the latest FIDE-rated tournaments
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {recentEvents.map((e) => (
              <Link
                key={e.slug}
                href={`/event/${e.slug}`}
                className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-4 py-3 hover:bg-zinc-800/50 hover:border-zinc-700/50 transition-all group"
              >
                <div className="text-sm text-zinc-300 group-hover:text-white transition-colors truncate">
                  {e.name}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                  <span>{e.gameCount} games</span>
                  {e.avgElo && (
                    <>
                      <span className="text-zinc-700">·</span>
                      <span>avg {e.avgElo}</span>
                    </>
                  )}
                  {e.dateEnd && (
                    <>
                      <span className="text-zinc-700">·</span>
                      <span>{formatEventDate(e.dateEnd)}</span>
                    </>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="w-full max-w-2xl py-16 border-t border-zinc-800/50">
        <h2 className="text-xl font-bold text-white text-center mb-8">
          Frequently Asked Questions
        </h2>
        <div className="space-y-3">
          {faqs.map((f) => (
            <details
              key={f.q}
              className="group rounded-lg border border-zinc-800/50 bg-zinc-900/30"
            >
              <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-zinc-300 hover:text-white transition-colors list-none flex items-center justify-between">
                {f.q}
                <span className="text-zinc-600 group-open:rotate-45 transition-transform text-lg">
                  +
                </span>
              </summary>
              <p className="px-5 pb-4 text-sm text-zinc-400 leading-relaxed">
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      <footer className="w-full max-w-lg text-center pb-6 pt-10 space-y-3">
        <p className="text-sm text-zinc-400">
          Have an idea to make outprep better?{" "}
          <a
            href="https://github.com/dscape/outprep/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-500 hover:text-green-400 underline underline-offset-2"
          >
            Suggest an improvement
          </a>
        </p>
        <p className="text-[10px] text-zinc-800">
          Made with &#10084; in Porto. Donations:{" "}
          <span className="font-mono text-zinc-700 break-all">
            0x8EAc5fDF6bFff841964441444d260A66198D9538
          </span>
        </p>
      </footer>
    </div>
  );
}

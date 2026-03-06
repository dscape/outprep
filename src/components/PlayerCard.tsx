"use client";

import Link from "next/link";
import { PlayerProfile } from "@/lib/types";
import { TitleBadge } from "@/components/title-badge";
import { CountryFlag } from "@/components/country-flag";

interface PlayerCardProps {
  profile: PlayerProfile;
  filteredGames?: number;
  /** FIDE-specific display fields (optional) */
  title?: string | null;
  federation?: string;
  fideId?: string;
  winRate?: number;
  drawRate?: number;
  lossRate?: number;
  recentEvents?: string[];
  /** Use h1 instead of h2 for the name (top-level hero usage) */
  hero?: boolean;
  /** Pre-computed event name → slug map (computed server-side) */
  eventSlugs?: Record<string, string>;
}

function StyleBar({ label, value, tooltip }: { label: string; value: number; tooltip?: string }) {
  const getColor = (val: number) => {
    if (val >= 75) return "bg-green-500";
    if (val >= 50) return "bg-yellow-500";
    if (val >= 25) return "bg-orange-500";
    return "bg-red-500";
  };

  return (
    <div className="flex items-center gap-3" title={tooltip}>
      <span className="w-24 text-sm text-zinc-400">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-zinc-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${getColor(value)}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right text-sm font-mono text-zinc-300">{value}</span>
    </div>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  return (
    <div className="flex items-center gap-2 mt-1" title="Confidence based on number of rated games and rating stability. More games = higher confidence.">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
        <div
          className="h-full rounded-full bg-green-500/70 transition-all duration-500"
          style={{ width: `${confidence}%` }}
        />
      </div>
      <span className="text-xs text-zinc-500">{confidence}% confidence</span>
    </div>
  );
}

export default function PlayerCard({
  profile,
  filteredGames,
  title,
  federation,
  fideId,
  winRate,
  drawRate,
  lossRate,
  recentEvents,
  hero,
  eventSlugs,
}: PlayerCardProps) {
  const displayGames = filteredGames ?? profile.analyzedGames;
  const ratings = Object.entries(profile.ratings || {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ({ label: k, value: v as number }));
  const totalResults = (winRate ?? 0) + (drawRate ?? 0) + (lossRate ?? 0);

  const NameTag = hero ? "h1" : "h2";

  return (
    <>
      {/* Hero Card */}
      <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <NameTag className="text-2xl font-bold text-white">{profile.username}</NameTag>
              {title && <TitleBadge title={title} />}
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              {federation && (
                <>
                  <CountryFlag federation={federation} showCode className="text-zinc-300 font-medium" />
                  {" · "}
                </>
              )}
              {displayGames.toLocaleString()} games analyzed
              {profile.totalGames !== displayGames && (
                <span className="text-zinc-500">
                  {" "}(of {profile.totalGames.toLocaleString()} total)
                </span>
              )}
              {fideId && (
                <>
                  {" · "}
                  <a
                    href={`https://ratings.fide.com/profile/${fideId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    FIDE #{fideId}
                  </a>
                </>
              )}
              {totalResults > 0 && (
                <span className="text-zinc-500">
                  {" · "}{winRate}W {drawRate}D {lossRate}L
                </span>
              )}
            </p>
          </div>
          {profile.fideEstimate ? (
            <div className="text-right" title="Estimated FIDE rating based on Lichess ratings, adjusted for time control and opponent strength">
              <div className="text-3xl font-bold text-green-400">
                ~{profile.fideEstimate.rating}
              </div>
              <div className="text-xs text-zinc-500 uppercase tracking-wide">
                Est. FIDE
              </div>
              <ConfidenceBar confidence={profile.fideEstimate.confidence} />
            </div>
          ) : null}
        </div>

        {/* Ratings — pill badges */}
        {ratings.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-3">
            {ratings.map(({ label, value }) => (
              <div
                key={label}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm"
              >
                <span className="text-zinc-500 capitalize">{label}</span>{" "}
                <span className="font-mono text-white">{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Recent Events (FIDE) */}
        {recentEvents && recentEvents.length > 0 && eventSlugs && (
          <div className="mt-6">
            <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-2">Recent Events</h3>
            <div className="flex flex-wrap gap-2">
              {recentEvents.map((event) => (
                <Link
                  key={event}
                  href={`/event/${eventSlugs[event] || encodeURIComponent(event)}`}
                  className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  {event}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Playing Style — separate container below hero */}
      {profile.style && profile.style.sampleSize > 0 && (
        <div className="mt-4 rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6 space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide">
              Playing Style
            </h3>
            {profile.style.sampleSize < 30 && (
              <span className="text-xs text-zinc-500">
                Based on {profile.style.sampleSize} games — estimates may shift with more data
              </span>
            )}
          </div>
          <StyleBar label="Aggression" value={profile.style.aggression}
            tooltip="Tendency to win games quickly and sacrifice material. Higher = more aggressive play." />
          <StyleBar label="Tactical" value={profile.style.tactical}
            tooltip="Frequency of decisive games under 40 moves. Higher = more tactical, sharp play." />
          <StyleBar label="Positional" value={profile.style.positional}
            tooltip="Ability to avoid early losses and play longer strategic games. Higher = more solid positional play." />
          <StyleBar label="Endgame" value={profile.style.endgame}
            tooltip="Win rate in games lasting 30+ moves. Higher = better at converting advantages in endgames." />
        </div>
      )}
    </>
  );
}

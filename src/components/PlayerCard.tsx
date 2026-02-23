"use client";

import { PlayerProfile } from "@/lib/types";

interface PlayerCardProps {
  profile: PlayerProfile;
  filteredGames?: number;
}

function StyleBar({ label, value }: { label: string; value: number }) {
  const getColor = (val: number) => {
    if (val >= 75) return "bg-green-500";
    if (val >= 50) return "bg-yellow-500";
    if (val >= 25) return "bg-orange-500";
    return "bg-red-500";
  };

  return (
    <div className="flex items-center gap-3">
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
    <div className="flex items-center gap-2 mt-1">
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

export default function PlayerCard({ profile, filteredGames }: PlayerCardProps) {
  const displayGames = filteredGames ?? profile.analyzedGames;
  const ratings = Object.entries(profile.ratings)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ({ label: k, value: v as number }));

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{profile.username}</h2>
          <p className="text-sm text-zinc-400 mt-1">
            {displayGames.toLocaleString()} standard games analyzed
            {profile.totalGames !== displayGames && (
              <span className="text-zinc-500">
                {" "}(of {profile.totalGames.toLocaleString()} total)
              </span>
            )}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-green-400">
            ~{profile.fideEstimate.rating}
          </div>
          <div className="text-xs text-zinc-500 uppercase tracking-wide">
            Est. FIDE
          </div>
          <ConfidenceBar confidence={profile.fideEstimate.confidence} />
        </div>
      </div>

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

      <div className="mt-6 space-y-3">
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
        <StyleBar label="Aggression" value={profile.style.aggression} />
        <StyleBar label="Tactical" value={profile.style.tactical} />
        <StyleBar label="Positional" value={profile.style.positional} />
        <StyleBar label="Endgame" value={profile.style.endgame} />
      </div>
    </div>
  );
}

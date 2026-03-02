"use client";

import { useState } from "react";
import { OTBProfile, OpeningStats } from "@/lib/types";

interface OTBAnalysisTabProps {
  profile: OTBProfile;
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
      <span className="w-8 text-right text-sm font-mono text-zinc-300">
        {value}
      </span>
    </div>
  );
}

function WDLBar({
  win,
  draw,
  loss,
}: {
  win: number;
  draw: number;
  loss: number;
}) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      <div className="bg-green-500" style={{ width: `${win}%` }} />
      <div className="bg-zinc-400" style={{ width: `${draw}%` }} />
      <div className="bg-red-500" style={{ width: `${loss}%` }} />
    </div>
  );
}

function OpeningsTable({ openings }: { openings: OpeningStats[] }) {
  if (openings.length === 0) {
    return (
      <p className="text-sm text-zinc-500">No opening data available.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-700 text-left text-zinc-400">
            <th className="pb-2 pr-4 font-medium">ECO</th>
            <th className="pb-2 pr-4 font-medium">Opening</th>
            <th className="pb-2 pr-4 font-medium text-right">Games</th>
            <th className="pb-2 pr-4 font-medium text-right">Freq</th>
            <th className="pb-2 pr-4 font-medium min-w-[120px]">
              W / D / L
            </th>
          </tr>
        </thead>
        <tbody>
          {openings.map((op) => (
            <tr
              key={`${op.eco}-${op.name}`}
              className="border-b border-zinc-800 text-zinc-300"
            >
              <td className="py-2 pr-4 font-mono text-green-400">
                {op.eco}
              </td>
              <td className="py-2 pr-4 max-w-[200px] truncate">{op.name}</td>
              <td className="py-2 pr-4 text-right font-mono">{op.games}</td>
              <td className="py-2 pr-4 text-right font-mono">{op.pct}%</td>
              <td className="py-2 pr-4">
                <div className="space-y-1">
                  <WDLBar
                    win={op.winRate}
                    draw={op.drawRate}
                    loss={op.lossRate}
                  />
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span className="text-green-400">{op.winRate}%</span>
                    <span>{op.drawRate}%</span>
                    <span className="text-red-400">{op.lossRate}%</span>
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OTBAnalysisTab({ profile }: OTBAnalysisTabProps) {
  const [openingColor, setOpeningColor] = useState<"white" | "black">(
    "white"
  );
  const [showGames, setShowGames] = useState(false);

  const openings =
    openingColor === "white"
      ? profile.openings.white
      : profile.openings.black;

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="text-sm text-zinc-400">
        Analysis based on{" "}
        <span className="font-medium text-white">
          {profile.totalGames} OTB game{profile.totalGames !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Playing Style */}
      <div>
        <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-3">
          Playing Style (OTB)
        </h3>
        <div className="space-y-3">
          <StyleBar label="Aggression" value={profile.style.aggression} />
          <StyleBar label="Tactical" value={profile.style.tactical} />
          <StyleBar label="Positional" value={profile.style.positional} />
          <StyleBar label="Endgame" value={profile.style.endgame} />
        </div>
        {profile.style.sampleSize < 30 && (
          <p className="mt-2 text-xs text-zinc-500">
            Based on {profile.style.sampleSize} games — estimates may shift
            with more data
          </p>
        )}
      </div>

      {/* Openings */}
      <div>
        <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-3">
          Openings (OTB)
        </h3>
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setOpeningColor("white")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              openingColor === "white"
                ? "bg-white text-zinc-900"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            As White
          </button>
          <button
            onClick={() => setOpeningColor("black")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              openingColor === "black"
                ? "bg-zinc-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            As Black
          </button>
        </div>
        <OpeningsTable openings={openings} />
      </div>

      {/* Weaknesses */}
      {profile.weaknesses.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-3">
            Weaknesses (OTB)
          </h3>
          <div className="space-y-3">
            {profile.weaknesses.map((w) => (
              <div
                key={w.area}
                className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-4"
              >
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-medium text-white">{w.area}</h4>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      w.severity === "critical"
                        ? "bg-red-500/20 text-red-400"
                        : w.severity === "moderate"
                          ? "bg-yellow-500/20 text-yellow-400"
                          : "bg-zinc-600/30 text-zinc-400"
                    }`}
                  >
                    {w.severity}
                  </span>
                </div>
                <p className="text-sm text-zinc-400">{w.description}</p>
                <p className="mt-1 text-xs text-zinc-500">{w.stat}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Game list */}
      <div>
        <button
          onClick={() => setShowGames(!showGames)}
          className="flex items-center gap-1 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <span className={`transition-transform ${showGames ? "rotate-90" : ""}`}>
            &#9654;
          </span>
          Game Results ({profile.totalGames})
        </button>

        {showGames && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700 text-left text-zinc-400">
                  <th className="pb-2 pr-4 font-medium">#</th>
                  <th className="pb-2 pr-4 font-medium">White</th>
                  <th className="pb-2 pr-4 font-medium">Black</th>
                  <th className="pb-2 pr-4 font-medium">Result</th>
                  <th className="pb-2 pr-4 font-medium">Event</th>
                  <th className="pb-2 pr-4 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {(profile.games || []).map((g, i) => (
                  <tr
                    key={i}
                    className="border-b border-zinc-800 text-zinc-300"
                  >
                    <td className="py-1.5 pr-4 text-zinc-500">{i + 1}</td>
                    <td className="py-1.5 pr-4 truncate max-w-[150px]">
                      {g.white}
                    </td>
                    <td className="py-1.5 pr-4 truncate max-w-[150px]">
                      {g.black}
                    </td>
                    <td className="py-1.5 pr-4 font-mono">
                      <span
                        className={
                          g.result === "1-0"
                            ? "text-green-400"
                            : g.result === "0-1"
                              ? "text-red-400"
                              : "text-zinc-400"
                        }
                      >
                        {g.result}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 truncate max-w-[180px] text-zinc-500">
                      {g.event || "—"}
                    </td>
                    <td className="py-1.5 pr-4 text-zinc-500">
                      {g.date || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

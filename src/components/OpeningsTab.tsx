"use client";

import { useState } from "react";
import { OpeningStats } from "@/lib/types";

interface OpeningsTabProps {
  white: OpeningStats[];
  black: OpeningStats[];
}

function WDLBar({ win, draw, loss }: { win: number; draw: number; loss: number }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      <div className="bg-green-500" style={{ width: `${win}%` }} />
      <div className="bg-zinc-400" style={{ width: `${draw}%` }} />
      <div className="bg-red-500" style={{ width: `${loss}%` }} />
    </div>
  );
}

export default function OpeningsTab({ white, black }: OpeningsTabProps) {
  const [color, setColor] = useState<"white" | "black">("white");
  const openings = color === "white" ? white : black;

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setColor("white")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            color === "white"
              ? "bg-white text-zinc-900"
              : "bg-zinc-800 text-zinc-400 hover:text-white"
          }`}
        >
          As White
        </button>
        <button
          onClick={() => setColor("black")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            color === "black"
              ? "bg-zinc-600 text-white"
              : "bg-zinc-800 text-zinc-400 hover:text-white"
          }`}
        >
          As Black
        </button>
      </div>

      {openings.length === 0 ? (
        <p className="text-sm text-zinc-500">No opening data available.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-left text-zinc-400">
                <th className="pb-2 pr-4 font-medium">ECO</th>
                <th className="pb-2 pr-4 font-medium">Opening</th>
                <th className="pb-2 pr-4 font-medium text-right">Games</th>
                <th className="pb-2 pr-4 font-medium text-right">Freq</th>
                <th className="pb-2 pr-4 font-medium min-w-[120px]">W / D / L</th>
              </tr>
            </thead>
            <tbody>
              {openings.map((op) => (
                <tr key={op.eco} className="border-b border-zinc-800 text-zinc-300">
                  <td className="py-2 pr-4 font-mono text-green-400">{op.eco}</td>
                  <td className="py-2 pr-4 max-w-[200px] truncate">{op.name}</td>
                  <td className="py-2 pr-4 text-right font-mono">{op.games}</td>
                  <td className="py-2 pr-4 text-right font-mono">{op.pct}%</td>
                  <td className="py-2 pr-4">
                    <div className="space-y-1">
                      <WDLBar win={op.winRate} draw={op.drawRate} loss={op.lossRate} />
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
      )}
    </div>
  );
}

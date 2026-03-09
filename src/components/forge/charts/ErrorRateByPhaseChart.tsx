"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { ExperimentRecord } from "@/lib/forge-types";

export function ErrorRateByPhaseChart({
  experiments,
}: {
  experiments: ExperimentRecord[];
}) {
  if (experiments.length === 0) return null;

  const data = experiments.map((exp) => ({
    name: `#${exp.number}`,
    opening: +exp.result.blunderRateDelta.opening.toFixed(4),
    middlegame: +exp.result.blunderRateDelta.middlegame.toFixed(4),
    endgame: +exp.result.blunderRateDelta.endgame.toFixed(4),
  }));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium text-zinc-500 mb-4">
        Error Rate by Phase{" "}
        <span className="text-zinc-600">(lower = better)</span>
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
          <XAxis
            dataKey="name"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            stroke="#3f3f46"
          />
          <YAxis
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            stroke="#3f3f46"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }}
          />
          <Line
            type="monotone"
            dataKey="opening"
            stroke="#fb7185"
            strokeWidth={2}
            dot={{ fill: "#fb7185", r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="middlegame"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={{ fill: "#38bdf8", r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="endgame"
            stroke="#a78bfa"
            strokeWidth={2}
            dot={{ fill: "#a78bfa", r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

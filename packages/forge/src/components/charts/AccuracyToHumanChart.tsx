"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { ExperimentRecord } from "@/lib/forge-types";

export function AccuracyToHumanChart({
  experiments,
  baselineAccuracy,
}: {
  experiments: ExperimentRecord[];
  baselineAccuracy?: number;
}) {
  if (experiments.length === 0) return null;

  const data = experiments.map((exp) => ({
    name: `#${exp.number}`,
    accuracy: +(exp.result.moveAccuracy * 100).toFixed(1),
  }));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium text-zinc-500 mb-4">
        Accuracy to Human
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
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [`${Number(value).toFixed(1)}%`, "Accuracy"]}
          />
          {baselineAccuracy !== undefined && (
            <ReferenceLine
              y={baselineAccuracy * 100}
              stroke="#71717a"
              strokeDasharray="4 4"
              label={{ value: "baseline", fill: "#71717a", fontSize: 10 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="accuracy"
            stroke="#34d399"
            strokeWidth={2}
            dot={{ fill: "#34d399", r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

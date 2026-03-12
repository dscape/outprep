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
import type { OracleSurpriseEntry } from "@/lib/forge-types";

export function SurpriseRateTrendChart({
  surprises,
}: {
  surprises: OracleSurpriseEntry[];
}) {
  if (surprises.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-xs font-medium text-zinc-500 mb-2">
          Surprise Rate Trend
        </p>
        <p className="text-center py-8 text-zinc-500 text-sm">
          No surprise data to chart.
        </p>
      </div>
    );
  }

  // Sort by timestamp and compute running surprise rate
  const sorted = [...surprises].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  let surprisingCount = 0;
  const data = sorted.map((entry, i) => {
    if (entry.wasSurprising) surprisingCount++;
    const runningSurpriseRate = surprisingCount / (i + 1);
    return {
      query: i + 1,
      rate: +runningSurpriseRate.toFixed(3),
    };
  });

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium text-zinc-500 mb-4">
        Surprise Rate Trend
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
          <XAxis
            dataKey="query"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            stroke="#3f3f46"
            label={{
              value: "Query #",
              position: "insideBottomRight",
              offset: -5,
              fill: "#71717a",
              fontSize: 10,
            }}
          />
          <YAxis
            domain={[0, 1]}
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            stroke="#3f3f46"
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [
              `${(Number(value) * 100).toFixed(1)}%`,
              "Surprise Rate",
            ]}
            labelFormatter={(label) => `Query #${label}`}
          />
          <ReferenceLine
            y={0.2}
            stroke="#71717a"
            strokeDasharray="4 4"
            label={{
              value: "health threshold",
              fill: "#71717a",
              fontSize: 10,
            }}
          />
          <Line
            type="monotone"
            dataKey="rate"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ fill: "#10b981", r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

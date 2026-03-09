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

export function CplAccuracyChart({
  experiments,
  baselineCplKL,
}: {
  experiments: ExperimentRecord[];
  baselineCplKL?: number;
}) {
  if (experiments.length === 0) return null;

  const data = experiments.map((exp) => ({
    name: `#${exp.number}`,
    cplKL: +exp.result.cplKLDivergence.toFixed(4),
  }));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium text-zinc-500 mb-4">
        CPL Accuracy{" "}
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
            formatter={(value) => [Number(value).toFixed(4), "KL Divergence"]}
          />
          {baselineCplKL !== undefined && (
            <ReferenceLine
              y={baselineCplKL}
              stroke="#71717a"
              strokeDasharray="4 4"
              label={{ value: "baseline", fill: "#71717a", fontSize: 10 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="cplKL"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={{ fill: "#f59e0b", r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

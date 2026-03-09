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

export function AccuracyTrendChart({
  experiments,
  baselineAccuracy,
  baselineComposite,
}: {
  experiments: ExperimentRecord[];
  baselineAccuracy?: number;
  baselineComposite?: number;
}) {
  if (experiments.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500 text-sm">
        No experiment data to chart.
      </div>
    );
  }

  const data = experiments.map((exp) => ({
    name: `#${exp.number}`,
    accuracy: +(exp.result.moveAccuracy * 100).toFixed(1),
    composite: +exp.result.compositeScore.toFixed(3),
  }));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium text-zinc-500 mb-4">
        Accuracy & Composite Score Trend
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
          <XAxis
            dataKey="name"
            tick={{ fill: "#a1a1aa", fontSize: 12 }}
            stroke="#3f3f46"
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: "#a1a1aa", fontSize: 12 }}
            stroke="#3f3f46"
            label={{
              value: "Accuracy %",
              angle: -90,
              position: "insideLeft",
              fill: "#71717a",
              fontSize: 11,
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: "#a1a1aa", fontSize: 12 }}
            stroke="#3f3f46"
            label={{
              value: "Composite",
              angle: 90,
              position: "insideRight",
              fill: "#71717a",
              fontSize: 11,
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          {baselineAccuracy !== undefined && (
            <ReferenceLine
              yAxisId="left"
              y={baselineAccuracy * 100}
              stroke="#71717a"
              strokeDasharray="4 4"
              label={{ value: "baseline", fill: "#71717a", fontSize: 10 }}
            />
          )}
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="accuracy"
            stroke="#34d399"
            strokeWidth={2}
            dot={{ fill: "#34d399", r: 3 }}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="composite"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={{ fill: "#60a5fa", r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

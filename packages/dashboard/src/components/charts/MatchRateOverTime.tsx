import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { TestResult } from "../../types";
import { getRunColor } from "../../lib/colors";

interface MatchRateOverTimeProps {
  results: TestResult[];
}

type MetricKey = "matchRate" | "topNRate" | "cplDelta";

const METRIC_LABELS: Record<MetricKey, string> = {
  matchRate: "Match Rate (%)",
  topNRate: "Top-4 Rate (%)",
  cplDelta: "CPL Delta",
};

export function MatchRateOverTime({ results }: MatchRateOverTimeProps) {
  const [metric, setMetric] = useState<MetricKey>("matchRate");

  if (results.length < 2) {
    return (
      <p className="text-sm text-gray-400 italic">
        Load 2+ results to see trends over time.
      </p>
    );
  }

  // Sort by timestamp
  const sorted = [...results].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const isPercentage = metric !== "cplDelta";

  const data = sorted.map((r) => {
    const raw = r.metrics[metric];
    return {
      label: r.label,
      time: new Date(r.timestamp).toLocaleDateString(),
      value: isPercentage ? +(raw * 100).toFixed(1) : +raw.toFixed(1),
    };
  });

  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <h3 className="text-sm font-semibold text-gray-700">
          Metric Over Time
        </h3>
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as MetricKey)}
          className="text-sm border rounded px-2 py-1"
        >
          {(Object.keys(METRIC_LABELS) as MetricKey[]).map((k) => (
            <option key={k} value={k}>
              {METRIC_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis
            domain={isPercentage ? [0, 100] : undefined}
            label={{
              value: METRIC_LABELS[metric],
              angle: -90,
              position: "insideLeft",
            }}
          />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="value"
            stroke={getRunColor(0)}
            strokeWidth={2}
            dot={{ r: 5 }}
            name={METRIC_LABELS[metric]}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

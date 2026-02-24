import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { TestResult } from "../../types";
import { getRunColor } from "../../lib/colors";

interface CPLComparisonProps {
  results: TestResult[];
}

export function CPLComparison({ results }: CPLComparisonProps) {
  if (results.length === 0) return null;

  const data = results.map((r, i) => ({
    label: r.label,
    "Actual CPL": +r.metrics.avgActualCPL.toFixed(1),
    "Bot CPL": +r.metrics.avgBotCPL.toFixed(1),
    fill: getRunColor(i),
  }));

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        CPL: Actual vs Bot
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="Actual CPL" fill="#94a3b8" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Bot CPL" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {/* Delta bars */}
      <h3 className="text-sm font-semibold text-gray-700 mt-4 mb-2">
        CPL Delta (|Bot - Actual|) — lower is better
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={results.map((r, i) => ({
            label: r.label,
            delta: +r.metrics.cplDelta.toFixed(1),
            fill: getRunColor(i),
          }))}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip />
          {results.map((r, i) => (
            <Bar
              key={r.label}
              dataKey="delta"
              fill={getRunColor(i)}
              radius={[4, 4, 0, 0]}
              name={r.label}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

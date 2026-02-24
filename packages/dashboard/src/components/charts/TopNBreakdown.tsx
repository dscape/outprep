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

interface TopNBreakdownProps {
  results: TestResult[];
}

export function TopNBreakdown({ results }: TopNBreakdownProps) {
  if (results.length === 0) return null;

  // For each run: exact match %, (top4 - match) %, miss %
  const data = results.map((r, i) => {
    const m = r.metrics;
    const exactPct = +(m.matchRate * 100).toFixed(1);
    const top4OnlyPct = +((m.topNRate - m.matchRate) * 100).toFixed(1);
    const missPct = +((1 - m.topNRate) * 100).toFixed(1);

    return {
      label: r.label,
      "Exact Match": exactPct,
      "Top-4 (not exact)": Math.max(0, top4OnlyPct),
      Miss: Math.max(0, missPct),
      fill: getRunColor(i),
    };
  });

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        Move Accuracy Breakdown (%)
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis domain={[0, 100]} />
          <Tooltip />
          <Legend />
          <Bar
            dataKey="Exact Match"
            stackId="a"
            fill="#22c55e"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="Top-4 (not exact)"
            stackId="a"
            fill="#3b82f6"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="Miss"
            stackId="a"
            fill="#ef4444"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

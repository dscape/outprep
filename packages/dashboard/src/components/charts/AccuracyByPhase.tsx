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
import type { TestResult, GamePhase } from "../../types";
import { getRunColor } from "../../lib/colors";

interface AccuracyByPhaseProps {
  results: TestResult[];
}

const PHASES: GamePhase[] = ["opening", "middlegame", "endgame"];

export function AccuracyByPhase({ results }: AccuracyByPhaseProps) {
  if (results.length === 0) return null;

  const data = PHASES.map((phase) => {
    const row: Record<string, string | number> = { phase };
    for (const r of results) {
      const pm = r.metrics.byPhase[phase];
      row[r.label] = pm ? +(pm.matchRate * 100).toFixed(1) : 0;
    }
    return row;
  });

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        Match Rate by Phase (%)
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="phase" />
          <YAxis domain={[0, 100]} />
          <Tooltip />
          <Legend />
          {results.map((r, i) => (
            <Bar
              key={r.label}
              dataKey={r.label}
              fill={getRunColor(i)}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

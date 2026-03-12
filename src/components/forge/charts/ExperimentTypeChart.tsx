"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { ExperimentArchetype } from "@/lib/forge-types";

const COLORS: Record<string, string> = {
  incremental: "#3b82f6",
  exploratory: "#a855f7",
  unknown: "#52525b",
};

const LABELS: Record<string, string> = {
  incremental: "Incremental",
  exploratory: "Exploratory",
  unknown: "Unknown",
};

export function ExperimentTypeChart({
  experiments,
}: {
  experiments: { archetype?: ExperimentArchetype }[];
}) {
  const counts: Record<string, number> = { incremental: 0, exploratory: 0, unknown: 0 };
  for (const exp of experiments) {
    const key = exp.archetype ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const data = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([name, value]) => ({ name: LABELS[name] ?? name, value, key: name }));

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-xs font-medium text-zinc-500 mb-2">
          Experiment Types
        </p>
        <p className="text-center py-8 text-zinc-500 text-sm">
          No experiment data.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium text-zinc-500 mb-4">
        Experiment Types
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={70}
            paddingAngle={2}
            dataKey="value"
            label={({ name, value }) => `${name}: ${value}`}
          >
            {data.map((entry) => (
              <Cell
                key={entry.key}
                fill={COLORS[entry.key] ?? COLORS.unknown}
              />
            ))}
          </Pie>
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
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

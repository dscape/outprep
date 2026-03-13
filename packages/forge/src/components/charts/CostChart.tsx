"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { OracleRecord, ExperimentRecord } from "@/lib/forge-types";

interface CostEvent {
  label: string;
  timestamp: number;
  cumulativeCost: number;
}

export function CostChart({
  totalCostUsd,
  experiments,
  oracleConsultations,
}: {
  totalCostUsd: number;
  experiments: ExperimentRecord[];
  oracleConsultations: OracleRecord[];
}) {
  // Build cost timeline from events (approximate — we don't have per-event cost,
  // so we distribute cost proportionally across events)
  const events: { label: string; timestamp: number }[] = [
    ...experiments.map((e) => ({
      label: `Exp #${e.number}`,
      timestamp: new Date(e.timestamp).getTime(),
    })),
    ...oracleConsultations.map((o, i) => ({
      label: `Oracle ${i + 1}`,
      timestamp: new Date(o.timestamp).getTime(),
    })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-xs font-medium text-zinc-500 mb-2">Cost</p>
        <p className="text-lg font-mono text-zinc-100">
          ${totalCostUsd.toFixed(2)}
        </p>
      </div>
    );
  }

  const costPerEvent = totalCostUsd / events.length;
  const data: CostEvent[] = events.map((e, i) => ({
    label: e.label,
    timestamp: e.timestamp,
    cumulativeCost: +((i + 1) * costPerEvent).toFixed(2),
  }));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium text-zinc-500 mb-4">
        Cumulative Cost (${totalCostUsd.toFixed(2)} total)
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
          <XAxis
            dataKey="label"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            stroke="#3f3f46"
          />
          <YAxis
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            stroke="#3f3f46"
            tickFormatter={(v: number) => `$${v}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [`$${Number(value).toFixed(2)}`, "Cost"]}
          />
          <Area
            type="monotone"
            dataKey="cumulativeCost"
            stroke="#f59e0b"
            fill="#f59e0b"
            fillOpacity={0.15}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

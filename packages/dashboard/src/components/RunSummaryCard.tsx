import type { TestResult } from "../types";
import { getRunColor } from "../lib/colors";

interface RunSummaryCardProps {
  result: TestResult;
  index: number;
  onRemove: () => void;
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export function RunSummaryCard({ result, index, onRemove }: RunSummaryCardProps) {
  const color = getRunColor(index);
  const m = result.metrics;
  const date = new Date(result.timestamp).toLocaleDateString();

  return (
    <div
      className="bg-white rounded-lg shadow-sm border p-4 relative"
      style={{ borderLeftColor: color, borderLeftWidth: 4 }}
    >
      <button
        onClick={onRemove}
        className="absolute top-2 right-2 text-gray-400 hover:text-red-500 text-sm"
        title="Remove"
      >
        &times;
      </button>

      <div className="mb-3">
        <h3 className="font-semibold text-lg" style={{ color }}>
          {result.label}
        </h3>
        <p className="text-xs text-gray-500">
          {result.username} &middot; Elo {result.elo} &middot; {date}
        </p>
        {result.version && (
          <p className="text-xs text-gray-400 font-mono">
            engine v{result.version.engineVersion} @{" "}
            {result.version.gitCommit}
            {result.version.gitDirty && (
              <span className="text-amber-500" title="Uncommitted changes">*</span>
            )}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <Stat label="Match Rate" value={pct(m.matchRate)} />
        <Stat label="Top-4 Rate" value={pct(m.topNRate)} />
        <Stat label="Positions" value={String(m.totalPositions)} />
        <Stat label="Book Coverage" value={pct(m.bookCoverage)} />
        <Stat label="Actual CPL" value={fmt(m.avgActualCPL)} />
        <Stat label="Bot CPL" value={fmt(m.avgBotCPL)} />
        <Stat
          label="CPL Delta"
          value={fmt(m.cplDelta)}
          highlight={m.cplDelta < 15}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-gray-500 text-xs">{label}</div>
      <div
        className={`font-mono font-medium ${highlight ? "text-green-600" : "text-gray-900"}`}
      >
        {value}
      </div>
    </div>
  );
}

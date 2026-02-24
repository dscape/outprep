import type { TestResult } from "../types";
import { getRunColor } from "../lib/colors";

interface ComparisonTableProps {
  results: TestResult[];
}

function pct(n: number): string {
  return (n * 100).toFixed(1);
}

function fmt(n: number): string {
  return n.toFixed(1);
}

export function ComparisonTable({ results }: ComparisonTableProps) {
  if (results.length === 0) return null;

  // Find best values for highlighting
  const matchRates = results.map((r) => r.metrics.matchRate);
  const topNRates = results.map((r) => r.metrics.topNRate);
  const cplDeltas = results.map((r) => r.metrics.cplDelta);

  const bestMatch = Math.max(...matchRates);
  const bestTopN = Math.max(...topNRates);
  const bestDelta = Math.min(...cplDeltas);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2 px-3 font-medium">Label</th>
            <th className="py-2 px-3 font-medium text-right">Elo</th>
            <th className="py-2 px-3 font-medium text-right">Positions</th>
            <th className="py-2 px-3 font-medium text-right">Match %</th>
            <th className="py-2 px-3 font-medium text-right">Top-4 %</th>
            <th className="py-2 px-3 font-medium text-right">Book %</th>
            <th className="py-2 px-3 font-medium text-right">aCPL</th>
            <th className="py-2 px-3 font-medium text-right">bCPL</th>
            <th className="py-2 px-3 font-medium text-right">Delta</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const m = r.metrics;
            const color = getRunColor(i);
            return (
              <tr key={i} className="border-b hover:bg-gray-50">
                <td className="py-2 px-3">
                  <span
                    className="inline-block w-3 h-3 rounded-full mr-2"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-medium">{r.label}</span>
                </td>
                <td className="py-2 px-3 text-right font-mono">{r.elo}</td>
                <td className="py-2 px-3 text-right font-mono">
                  {m.totalPositions}
                </td>
                <td
                  className={`py-2 px-3 text-right font-mono ${m.matchRate === bestMatch ? "text-green-600 font-bold" : ""}`}
                >
                  {pct(m.matchRate)}
                </td>
                <td
                  className={`py-2 px-3 text-right font-mono ${m.topNRate === bestTopN ? "text-green-600 font-bold" : ""}`}
                >
                  {pct(m.topNRate)}
                </td>
                <td className="py-2 px-3 text-right font-mono">
                  {pct(m.bookCoverage)}
                </td>
                <td className="py-2 px-3 text-right font-mono">
                  {fmt(m.avgActualCPL)}
                </td>
                <td className="py-2 px-3 text-right font-mono">
                  {fmt(m.avgBotCPL)}
                </td>
                <td
                  className={`py-2 px-3 text-right font-mono ${m.cplDelta === bestDelta ? "text-green-600 font-bold" : ""}`}
                >
                  {fmt(m.cplDelta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

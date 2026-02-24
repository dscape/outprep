import type { TestResult } from "../types";
import { getRunColor } from "../lib/colors";

interface ConfigDiffProps {
  results: TestResult[];
}

/**
 * Shows which BotConfig fields differ between runs.
 * Useful for quickly seeing what changed between experiments.
 */
export function ConfigDiff({ results }: ConfigDiffProps) {
  if (results.length < 2) return null;

  // Collect all config keys across runs
  const allKeys = new Set<string>();
  for (const r of results) {
    for (const key of Object.keys(r.configOverrides || {})) {
      allKeys.add(key);
    }
  }

  const sortedKeys = Array.from(allKeys).sort();
  const hasResolvedConfig = results.some((r) => r.resolvedConfig);

  return (
    <div className="space-y-4">
      {sortedKeys.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 px-3 font-medium">Config Key</th>
                {results.map((r, i) => (
                  <th key={i} className="py-2 px-3 font-medium">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1"
                      style={{ backgroundColor: getRunColor(i) }}
                    />
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedKeys.map((key) => (
                <tr key={key} className="border-b">
                  <td className="py-2 px-3 font-mono text-gray-700">{key}</td>
                  {results.map((r, i) => {
                    const val = (r.configOverrides || {})[key];
                    return (
                      <td key={i} className="py-2 px-3 font-mono text-xs">
                        {val !== undefined ? JSON.stringify(val) : (
                          <span className="text-gray-300">default</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">
          No config overrides in loaded runs.
        </p>
      )}

      {hasResolvedConfig && (
        <details>
          <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
            View full resolved configs
          </summary>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.map((r, i) => (
              <div key={i} className="text-xs">
                <div className="font-medium mb-1" style={{ color: getRunColor(i) }}>
                  {r.label}
                </div>
                <pre className="bg-gray-50 rounded p-2 overflow-auto max-h-64 font-mono text-gray-700">
                  {r.resolvedConfig
                    ? JSON.stringify(r.resolvedConfig, null, 2)
                    : "N/A (older result format)"}
                </pre>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

import { useState, useCallback } from "react";
import { useResults } from "./hooks/useResults";
import { FileLoader } from "./components/FileLoader";
import { RunSummaryCard } from "./components/RunSummaryCard";
import { ComparisonTable } from "./components/ComparisonTable";
import { ConfigDiff } from "./components/ConfigDiff";
import { AccuracyByPhase } from "./components/charts/AccuracyByPhase";
import { CPLComparison } from "./components/charts/CPLComparison";
import { TopNBreakdown } from "./components/charts/TopNBreakdown";
import { MatchRateOverTime } from "./components/charts/MatchRateOverTime";

type Tab = "overview" | "phases" | "cpl" | "accuracy" | "trends";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "phases", label: "Phase Breakdown" },
  { key: "cpl", label: "CPL Analysis" },
  { key: "accuracy", label: "Accuracy" },
  { key: "trends", label: "Trends" },
];

export default function App() {
  const { results, error, loadFromFile, removeResult, clearAll } = useResults();
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const handleFiles = useCallback(
    (files: File[]) => {
      for (const f of files) loadFromFile(f);
    },
    [loadFromFile]
  );

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Outprep Dashboard
            </h1>
            <p className="text-sm text-gray-500">
              Compare engine accuracy across iterations
            </p>
          </div>
          {results.length > 0 && (
            <button
              onClick={clearAll}
              className="text-sm text-gray-400 hover:text-red-500 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* File loader */}
        <FileLoader onFilesSelected={handleFiles} />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {results.length > 0 && (
          <>
            {/* Tabs */}
            <div className="border-b border-gray-200">
              <nav className="flex gap-4">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`py-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab.key
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Tab content */}
            <div className="space-y-6">
              {activeTab === "overview" && (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {results.map((r, i) => (
                      <RunSummaryCard
                        key={`${r.label}-${r.timestamp}`}
                        result={r}
                        index={i}
                        onRemove={() => removeResult(i)}
                      />
                    ))}
                  </div>

                  {/* Comparison table */}
                  <Section title="Comparison">
                    <ComparisonTable results={results} />
                  </Section>

                  {/* Config diff */}
                  <Section title="Config Differences">
                    <ConfigDiff results={results} />
                  </Section>
                </>
              )}

              {activeTab === "phases" && (
                <Section title="Accuracy by Phase">
                  <AccuracyByPhase results={results} />
                </Section>
              )}

              {activeTab === "cpl" && (
                <Section title="Centipawn Loss Analysis">
                  <CPLComparison results={results} />
                </Section>
              )}

              {activeTab === "accuracy" && (
                <Section title="Move Accuracy Breakdown">
                  <TopNBreakdown results={results} />
                </Section>
              )}

              {activeTab === "trends" && (
                <Section title="Metrics Over Time">
                  <MatchRateOverTime results={results} />
                </Section>
              )}
            </div>
          </>
        )}

        {results.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg">No results loaded</p>
            <p className="text-sm mt-1">
              Run the harness and drag result JSON files above to compare
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border p-4">
      <h2 className="text-base font-semibold text-gray-800 mb-3">{title}</h2>
      {children}
    </div>
  );
}

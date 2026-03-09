"use client";

import { useState } from "react";
import type { ForgeSession, ExperimentRecord } from "@/lib/forge-types";
import { CostDisplay } from "@/components/forge/CostDisplay";
import { ExperimentTimeline } from "@/components/forge/ExperimentTimeline";
import { OracleCard } from "@/components/forge/OracleCard";
import { MarkdownContent } from "@/components/forge/MarkdownContent";
import { AccuracyTrendChart } from "@/components/forge/charts/AccuracyTrendChart";
import { CostChart } from "@/components/forge/charts/CostChart";

type Tab = "overview" | "experiments" | "oracle" | "logs";

export function SessionTabs({
  session,
  logs,
}: {
  session: Omit<ForgeSession, "conversationHistory">;
  logs: { filename: string; content: string }[];
}) {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "experiments", label: "Experiments", count: session.experiments.length },
    { key: "oracle", label: "Oracle", count: session.oracleConsultations.length },
    { key: "logs", label: "Logs", count: logs.length },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-zinc-800 mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "text-zinc-100 border-b-2 border-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 text-xs text-zinc-600">({t.count})</span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab session={session} />}
      {tab === "experiments" && (
        <ExperimentTimeline experiments={session.experiments} />
      )}
      {tab === "oracle" && <OracleTab session={session} />}
      {tab === "logs" && <LogsTab logs={logs} />}
    </div>
  );
}

function OverviewTab({
  session,
}: {
  session: Omit<ForgeSession, "conversationHistory">;
}) {
  const githubBranch = session.worktreeBranch;

  return (
    <div className="space-y-6">
      {/* Cost */}
      <Card title="Cost">
        <CostDisplay
          costUsd={session.totalCostUsd}
          inputTokens={session.totalInputTokens}
          outputTokens={session.totalOutputTokens}
        />
      </Card>

      {/* Git */}
      <Card title="Branch">
        <code className="text-sm font-mono text-zinc-300">{githubBranch}</code>
      </Card>

      {/* Baseline */}
      {session.baseline && (
        <Card title="Baseline Metrics">
          <MetricsGrid metrics={session.baseline.aggregate} />
          {session.baseline.playerMetrics.length > 0 && (
            <div className="mt-4 pt-3 border-t border-zinc-800">
              <p className="text-xs font-medium text-zinc-500 mb-2">
                Per-Player
              </p>
              {session.baseline.playerMetrics.map((pm) => (
                <div key={pm.username} className="mb-2">
                  <p className="text-sm text-zinc-300">
                    {pm.username}{" "}
                    <span className="text-zinc-500">
                      ({pm.elo} Elo, {pm.positionsEvaluated} positions)
                    </span>
                  </p>
                  <MetricsGrid metrics={pm.metrics} compact />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Best result */}
      {session.bestResult && (
        <Card title="Best Result">
          <MetricsGrid metrics={session.bestResult} />
        </Card>
      )}

      {/* Charts */}
      {session.experiments.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <AccuracyTrendChart
            experiments={session.experiments}
            baselineAccuracy={session.baseline?.aggregate.moveAccuracy}
            baselineComposite={session.baseline?.aggregate.compositeScore}
          />
          <CostChart
            totalCostUsd={session.totalCostUsd}
            experiments={session.experiments}
            oracleConsultations={session.oracleConsultations}
          />
        </div>
      )}

      {/* Cost chart when only oracle consultations */}
      {session.experiments.length === 0 && session.oracleConsultations.length > 0 && (
        <CostChart
          totalCostUsd={session.totalCostUsd}
          experiments={session.experiments}
          oracleConsultations={session.oracleConsultations}
        />
      )}

      {/* Summary when no baseline or experiments */}
      {!session.baseline && session.experiments.length === 0 && session.oracleConsultations.length === 0 && (
        <div className="text-sm text-zinc-500">
          Session has not computed a baseline yet.
        </div>
      )}
    </div>
  );
}

function OracleTab({
  session,
}: {
  session: Omit<ForgeSession, "conversationHistory">;
}) {
  if (session.oracleConsultations.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        No oracle consultations.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {session.oracleConsultations.map((o) => (
        <OracleCard key={o.id} oracle={o} />
      ))}
    </div>
  );
}

function LogsTab({ logs }: { logs: { filename: string; content: string }[] }) {
  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        No experiment logs yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {logs.map((log) => (
        <div
          key={log.filename}
          className="rounded-lg border border-zinc-800 bg-zinc-900 p-5"
        >
          <p className="text-xs font-mono text-zinc-500 mb-3">{log.filename}</p>
          <MarkdownContent content={log.content} />
        </div>
      ))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs font-medium text-zinc-500 mb-3">{title}</p>
      {children}
    </div>
  );
}

function MetricsGrid({
  metrics,
  compact,
}: {
  metrics: {
    moveAccuracy: number;
    compositeScore: number;
    cplKLDivergence: number;
    moveAccuracyByPhase: { opening: number; middlegame: number; endgame: number };
    positionsEvaluated: number;
  };
  compact?: boolean;
}) {
  const cls = compact ? "grid grid-cols-4 gap-2 text-xs" : "grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm";

  return (
    <div className={cls}>
      <div>
        <p className="text-zinc-500">Accuracy</p>
        <p className="font-mono text-zinc-200">
          {(metrics.moveAccuracy * 100).toFixed(1)}%
        </p>
      </div>
      <div>
        <p className="text-zinc-500">Composite</p>
        <p className="font-mono text-zinc-200">
          {metrics.compositeScore.toFixed(3)}
        </p>
      </div>
      <div>
        <p className="text-zinc-500">CPL KL</p>
        <p className="font-mono text-zinc-200">
          {metrics.cplKLDivergence.toFixed(4)}
        </p>
      </div>
      <div>
        <p className="text-zinc-500">Positions</p>
        <p className="font-mono text-zinc-200">{metrics.positionsEvaluated}</p>
      </div>
      {!compact && (
        <>
          <div>
            <p className="text-zinc-500">Opening</p>
            <p className="font-mono text-zinc-200">
              {(metrics.moveAccuracyByPhase.opening * 100).toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-zinc-500">Middlegame</p>
            <p className="font-mono text-zinc-200">
              {(metrics.moveAccuracyByPhase.middlegame * 100).toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-zinc-500">Endgame</p>
            <p className="font-mono text-zinc-200">
              {(metrics.moveAccuracyByPhase.endgame * 100).toFixed(1)}%
            </p>
          </div>
        </>
      )}
    </div>
  );
}

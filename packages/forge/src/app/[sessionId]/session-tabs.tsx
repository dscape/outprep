"use client";

import { useState } from "react";
import type { ForgeSession, ActivityEvent } from "@/lib/forge-types";
import { CostDisplay } from "@/components/CostDisplay";
import { ExperimentTimeline } from "@/components/ExperimentTimeline";
import { OracleCard } from "@/components/OracleCard";
import { MarkdownContent } from "@/components/MarkdownContent";
import { AccuracyTrendChart } from "@/components/charts/AccuracyTrendChart";
import { CostChart } from "@/components/charts/CostChart";
import { AccuracyToHumanChart } from "@/components/charts/AccuracyToHumanChart";
import { CplAccuracyChart } from "@/components/charts/CplAccuracyChart";
import { ErrorRateByPhaseChart } from "@/components/charts/ErrorRateByPhaseChart";
import { ConsoleLogViewer } from "@/components/ConsoleLogViewer";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { DiffViewer } from "@/components/DiffViewer";
import { HypothesisCard } from "@/components/HypothesisCard";
import { SurpriseRateIndicator } from "@/components/SurpriseRateIndicator";
import { ReflectionCard } from "@/components/ReflectionCard";
import { KillSignalCard } from "@/components/KillSignalCard";
import { ExperimentTypeChart } from "@/components/charts/ExperimentTypeChart";
import { SurpriseRateTrendChart } from "@/components/charts/SurpriseRateTrendChart";

export type Tab = "overview" | "activity" | "experiments" | "hypotheses" | "oracle" | "changes" | "logs" | "console";

export function SessionTabs({
  session,
  logs,
  activity,
  isDev,
  tab,
  onTabChange,
  agent,
}: {
  session: Omit<ForgeSession, "conversationHistory">;
  logs: { filename: string; content: string }[];
  activity?: ActivityEvent[];
  isDev?: boolean;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  agent?: { id: string; name: string; isRunning: boolean } | null;
}) {
  const [consoleHighlightTs, setConsoleHighlightTs] = useState<string | undefined>();

  const allCodeChanges = [
    ...session.activeChanges,
    ...session.experiments.flatMap((e) => e.codeChanges),
  ];

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "activity", label: "Activity", count: activity?.length },
    { key: "experiments", label: "Experiments", count: session.experiments.length },
    { key: "hypotheses", label: "Hypotheses", count: session.hypothesisSets?.length ?? 0 },
    { key: "oracle", label: "Oracle", count: session.oracleConsultations.length },
    { key: "changes", label: "Changes", count: allCodeChanges.length },
    { key: "logs", label: "Research Logs", count: logs.length },
    { key: "console", label: "Console" },
  ];

  function navigateToConsole(ts?: string) {
    setConsoleHighlightTs(ts);
    onTabChange("console");
  }

  function navigateToTab(targetTab: string) {
    onTabChange(targetTab as Tab);
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-zinc-800 mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${
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

      {tab === "overview" && <OverviewTab session={session} agent={agent} />}
      {tab === "activity" && (
        <ActivityTimeline
          events={activity || []}
          onNavigate={navigateToTab}
          onSeeInConsole={navigateToConsole}
        />
      )}
      {tab === "experiments" && (
        <ExperimentTimeline
          experiments={session.experiments}
          logs={logs}
          session={session}
          onSeeInConsole={navigateToConsole}
        />
      )}
      {tab === "hypotheses" && <HypothesesTab session={session} />}
      {tab === "oracle" && <OracleTab session={session} />}
      {tab === "changes" && (
        <ChangesTab session={session} onSeeInConsole={navigateToConsole} />
      )}
      {tab === "logs" && <LogsTab logs={logs} />}
      {tab === "console" && (
        <ConsoleLogViewer
          sessionId={session.id}
          sessionStatus={session.status}
          highlightTs={consoleHighlightTs}
        />
      )}
    </div>
  );
}

function OverviewTab({
  session,
  agent,
}: {
  session: Omit<ForgeSession, "conversationHistory">;
  agent?: { id: string; name: string; isRunning: boolean } | null;
}) {
  const githubBranch = session.worktreeBranch;

  return (
    <div className="space-y-6">
      {/* Agent */}
      {agent && (
        <Card title="Agent">
          <div className="flex items-center gap-3">
            <a href={`/agents/${agent.id}`} className="text-sm font-medium text-zinc-200 hover:text-emerald-400 transition-colors">
              {agent.name}
            </a>
            {agent.isRunning && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-800/50">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Running
              </span>
            )}
          </div>
        </Card>
      )}

      {/* Cost */}
      <Card title="Cost">
        <CostDisplay
          costUsd={session.totalCostUsd}
          inputTokens={session.totalInputTokens}
          outputTokens={session.totalOutputTokens}
          interactions={session.interactions ?? []}
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

      {/* Research Health */}
      {(() => {
        const surprises = session.oracleSurprises ?? [];
        const hypothesisSets = session.hypothesisSets ?? [];
        const currentHypothesis = hypothesisSets.length > 0 ? hypothesisSets[hypothesisSets.length - 1] : null;
        const hasSurprises = surprises.length > 0;
        const surprisingCount = surprises.filter(s => s.wasSurprising).length;
        const rate = hasSurprises ? surprisingCount / surprises.length : 0;

        return (currentHypothesis || hasSurprises) ? (
          <Card title="Research Health">
            <div className="space-y-3">
              {currentHypothesis && (
                <div>
                  <p className="text-xs text-zinc-500">Current Hypothesis</p>
                  <p className="text-sm text-zinc-200">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium mr-2 ${
                      currentHypothesis.committedLevel === "groundbreaking"
                        ? "border-purple-700 text-purple-400"
                        : currentHypothesis.committedLevel === "continuous-a"
                          ? "border-blue-700 text-blue-400"
                          : "border-amber-700 text-amber-400"
                    }`}>
                      {currentHypothesis.committedLevel}
                    </span>
                    {currentHypothesis.hypotheses.find(h => h.level === currentHypothesis.committedLevel)?.statement?.slice(0, 80)}
                  </p>
                </div>
              )}
              {hasSurprises && (
                <SurpriseRateIndicator
                  rate={rate}
                  totalEntries={surprises.length}
                  healthy={rate >= 0.2}
                  message={rate < 0.2 ? "Low surprise rate — may be confirming rather than exploring" : "Healthy surprise rate"}
                />
              )}
            </div>
          </Card>
        ) : null;
      })()}

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

      {/* Improvement vector charts */}
      {session.experiments.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <AccuracyToHumanChart
            experiments={session.experiments}
            baselineAccuracy={session.baseline?.aggregate.moveAccuracy}
          />
          <CplAccuracyChart
            experiments={session.experiments}
            baselineCplKL={session.baseline?.aggregate.cplKLDivergence}
          />
          <ErrorRateByPhaseChart experiments={session.experiments} />
        </div>
      )}

      {/* Experiment type + surprise rate charts */}
      {(session.experiments.length > 0 || (session.oracleSurprises ?? []).length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {session.experiments.length > 0 && (
            <ExperimentTypeChart experiments={session.experiments} />
          )}
          {(session.oracleSurprises ?? []).length > 0 && (
            <SurpriseRateTrendChart surprises={session.oracleSurprises ?? []} />
          )}
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

      {/* Raw state (dev mode) */}
      <RawStatePanel session={session} />
    </div>
  );
}

function ChangesTab({
  session,
  onSeeInConsole,
}: {
  session: Omit<ForgeSession, "conversationHistory">;
  onSeeInConsole: (ts?: string) => void;
}) {
  const hasActive = session.activeChanges.length > 0;
  const hasExperimentChanges = session.experiments.some((e) => e.codeChanges.length > 0);

  if (!hasActive && !hasExperimentChanges) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        No code changes yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hasActive && (
        <div>
          <h3 className="text-xs font-medium text-zinc-500 mb-3">Active (uncommitted) Changes</h3>
          <div className="space-y-3">
            {session.activeChanges.map((cc) => (
              <DiffViewer
                key={cc.id}
                change={cc}
                onSeeInConsole={() => onSeeInConsole(cc.timestamp)}
              />
            ))}
          </div>
        </div>
      )}

      {session.experiments.map((exp) =>
        exp.codeChanges.length > 0 ? (
          <div key={exp.id}>
            <h3 className="text-xs font-medium text-zinc-500 mb-3">
              Experiment #{exp.number}: {exp.hypothesis.slice(0, 60)}
            </h3>
            <div className="space-y-3">
              {exp.codeChanges.map((cc) => (
                <DiffViewer
                  key={cc.id}
                  change={cc}
                  onSeeInConsole={() => onSeeInConsole(cc.timestamp)}
                />
              ))}
            </div>
          </div>
        ) : null
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

function HypothesesTab({
  session,
}: {
  session: Omit<ForgeSession, "conversationHistory">;
}) {
  const hypothesisSets = session.hypothesisSets ?? [];
  const killSignals = session.killSignals ?? [];
  const reflections = session.reflections ?? [];

  if (hypothesisSets.length === 0 && killSignals.length === 0 && reflections.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        No hypotheses generated yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hypothesisSets.map((hs) => (
        <HypothesisCard
          key={hs.id}
          hypothesisSet={hs}
          killSignals={killSignals.filter((k) => k.hypothesisSetId === hs.id)}
        />
      ))}

      {reflections.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-zinc-500 mb-3">
            Reflections ({reflections.length})
          </h3>
          <div className="space-y-3">
            {reflections.map((r) => (
              <ReflectionCard key={r.id} reflection={r} />
            ))}
          </div>
        </div>
      )}

      {killSignals.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-zinc-500 mb-3">
            Kill Signals ({killSignals.length})
          </h3>
          <div className="space-y-3">
            {killSignals.map((k) => (
              <KillSignalCard key={k.id} killSignal={k} />
            ))}
          </div>
        </div>
      )}
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

function RawStatePanel({
  session,
}: {
  session: Omit<ForgeSession, "conversationHistory">;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 text-xs font-medium text-zinc-500 hover:text-zinc-400 transition-colors"
      >
        <span>Raw Session State (JSON)</span>
        <span>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <pre className="px-5 pb-4 text-xs font-mono text-zinc-400 overflow-x-auto max-h-[500px] overflow-y-auto">
          {JSON.stringify(session, null, 2)}
        </pre>
      )}
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

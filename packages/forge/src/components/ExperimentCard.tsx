"use client";

import { useState } from "react";
import type {
  ExperimentRecord,
  ForgeSession,
  OracleRecord,
  ReflectionCheckpoint,
  HypothesisSet,
} from "@/lib/forge-types";
import { MetricDelta } from "./MetricDelta";
import { MarkdownContent } from "./MarkdownContent";

const conclusionStyles: Record<string, string> = {
  confirmed: "bg-emerald-900/50 text-emerald-400 border-emerald-800",
  refuted: "bg-red-900/50 text-red-400 border-red-800",
  partial: "bg-amber-900/50 text-amber-400 border-amber-800",
  inconclusive: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

const categoryStyles: Record<string, string> = {
  algorithm: "text-blue-400",
  parameter: "text-purple-400",
  architecture: "text-amber-400",
  data: "text-emerald-400",
};

const archetypeStyles: Record<string, string> = {
  exploratory: "bg-amber-900/30 text-amber-400 border-amber-800/50",
  incremental: "bg-blue-900/30 text-blue-400 border-blue-800/50",
};

const levelLabels: Record<string, string> = {
  "continuous-a": "H1",
  "continuous-b": "H2",
  groundbreaking: "H3",
};

export function ExperimentCard({
  experiment,
  logContent,
  session,
  onSeeInConsole,
}: {
  experiment: ExperimentRecord;
  logContent?: string;
  session?: Partial<ForgeSession>;
  onSeeInConsole?: (ts: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const date = new Date(experiment.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const duration = experiment.evaluationDurationMs
    ? `${(experiment.evaluationDurationMs / 1000).toFixed(1)}s`
    : null;

  // Look up related session data
  const oracleRecord = session && experiment.oracleQueryId
    ? session.oracleConsultations?.find((o) => o.id === experiment.oracleQueryId)
    : undefined;

  const hypothesisSet = session && experiment.hypothesisSetId
    ? session.hypothesisSets?.find((h) => h.id === experiment.hypothesisSetId)
    : undefined;

  const committedHypothesis = hypothesisSet
    ? hypothesisSet.hypotheses.find((h) => h.level === hypothesisSet.committedLevel)
    : undefined;

  // Find reflections triggered after this experiment number
  const reflection = session?.reflections?.find(
    (r) => r.afterExperimentNumber === experiment.number
  );

  const archetype = experiment.archetype ?? "incremental";
  const levelLabel = experiment.hypothesisLevel
    ? levelLabels[experiment.hypothesisLevel] ?? experiment.hypothesisLevel
    : null;

  return (
    <div className="relative pl-8">
      {/* Timeline dot */}
      <div className="absolute left-0 top-2 w-4 h-4 rounded-full border-2 border-zinc-700 bg-zinc-900" />
      {/* Timeline line */}
      <div className="absolute left-[7px] top-6 bottom-0 w-0.5 bg-zinc-800" />

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 mb-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono text-zinc-500">
                #{experiment.number}
              </span>
              <span className={`text-xs ${categoryStyles[experiment.category] ?? "text-zinc-400"}`}>
                {experiment.category}
              </span>
              {levelLabel && (
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${archetypeStyles[archetype] ?? ""}`}>
                  {levelLabel} {archetype === "exploratory" ? "exploratory" : ""}
                </span>
              )}
              <span className="text-xs text-zinc-600">{date}</span>
              {duration && (
                <span className="text-xs text-zinc-600">{duration}</span>
              )}
              {experiment.positionsEvaluated > 0 && (
                <span className="text-xs text-zinc-600">
                  {experiment.positionsEvaluated} pos
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-zinc-200">
              {experiment.hypothesis}
            </p>
          </div>
          <span
            className={`inline-block shrink-0 ml-2 rounded-full border px-2.5 py-0.5 text-xs font-medium ${conclusionStyles[experiment.conclusion] ?? ""}`}
          >
            {experiment.conclusion}
          </span>
        </div>

        {/* Metric deltas */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          <MetricDelta
            label="Accuracy"
            value={experiment.delta.moveAccuracy}
            percentage
          />
          <MetricDelta
            label="Composite"
            value={experiment.delta.compositeScore}
          />
          <MetricDelta
            label="CPL KL"
            value={experiment.delta.cplKLDivergence}
            invert
          />
          {experiment.delta.blunderRateDelta != null && (
            <MetricDelta
              label="Blunder"
              value={experiment.delta.blunderRateDelta}
              invert
            />
          )}
        </div>

        {/* Expandable details */}
        <button
          onClick={() => setOpen(!open)}
          className="text-xs text-zinc-500 hover:text-zinc-300 mt-3 transition-colors flex items-center gap-1"
        >
          <span className="w-3 text-center">{open ? "▼" : "▶"}</span>
          {open ? "Hide details" : "Show details"}
        </button>

        {open && (
          <div className="mt-3 pt-3 border-t border-zinc-800 space-y-4">
            {/* Full Result Metrics */}
            {experiment.result && (
              <Section title="Results">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <MetricBox
                    label="Move Accuracy"
                    value={`${(experiment.result.moveAccuracy * 100).toFixed(1)}%`}
                  />
                  <MetricBox
                    label="Composite"
                    value={experiment.result.compositeScore.toFixed(4)}
                  />
                  <MetricBox
                    label="CPL KL Div"
                    value={experiment.result.cplKLDivergence.toFixed(4)}
                  />
                  <MetricBox
                    label="Book Coverage"
                    value={`${(((experiment.result.rawMetrics as any)?.bookCoverage ?? 0) * 100).toFixed(1)}%`}
                  />
                </div>
              </Section>
            )}

            {/* Hypothesis Context */}
            {committedHypothesis && hypothesisSet && (
              <Section title="Hypothesis Context">
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono px-1.5 py-0.5 rounded border ${archetypeStyles[archetype] ?? "border-zinc-700"}`}>
                      {hypothesisSet.committedLevel}
                    </span>
                    <span className="text-zinc-300">{committedHypothesis.statement}</span>
                  </div>
                  <p className="text-zinc-500 italic">
                    Falsification: {committedHypothesis.falsificationCriteria}
                  </p>
                </div>
              </Section>
            )}

            {/* Notes */}
            {experiment.notes && (
              <Section title="Notes">
                <p className="text-sm text-zinc-300">{experiment.notes}</p>
              </Section>
            )}

            {/* Next Steps */}
            {experiment.nextSteps.length > 0 && (
              <Section title="Next Steps">
                <ul className="text-sm text-zinc-300 list-disc pl-4 space-y-0.5">
                  {experiment.nextSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Code Changes */}
            {experiment.codeChanges.length > 0 && (
              <Section title="Code Changes">
                {experiment.codeChanges.map((c) => (
                  <div key={c.id} className="mb-2">
                    <p className="text-xs text-zinc-400 font-mono">{c.file}</p>
                    <p className="text-xs text-zinc-500">{c.description}</p>
                    {c.diff && (
                      <pre className="mt-1 text-xs bg-zinc-800 border border-zinc-700 rounded p-2 overflow-x-auto text-zinc-300">
                        {c.diff}
                      </pre>
                    )}
                  </div>
                ))}
              </Section>
            )}

            {/* Config Changes */}
            {experiment.configChanges.length > 0 && (
              <Section title="Config Changes">
                {experiment.configChanges.map((c, i) => (
                  <div
                    key={i}
                    className="text-xs font-mono flex items-center gap-2"
                  >
                    <span className="text-zinc-400">{c.path}:</span>
                    <span className="text-red-400">
                      {JSON.stringify(c.oldValue)}
                    </span>
                    <span className="text-zinc-600">&rarr;</span>
                    <span className="text-emerald-400">
                      {JSON.stringify(c.newValue)}
                    </span>
                  </div>
                ))}
              </Section>
            )}

            {/* Significance */}
            {experiment.significance.length > 0 && (
              <Section title="Significance">
                <div className="text-xs space-y-0.5">
                  {experiment.significance.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 font-mono">
                      <span className="text-zinc-400 w-24">
                        {s.metricName}
                      </span>
                      <span
                        className={
                          s.significant ? "text-emerald-400" : "text-zinc-500"
                        }
                      >
                        p={s.pValue.toFixed(3)} d={s.effectSize.toFixed(2)}
                      </span>
                      {s.significant && (
                        <span className="text-emerald-400">*</span>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Oracle Discussion */}
            {oracleRecord && (
              <Section title="Oracle Discussion">
                <OracleInline record={oracleRecord} />
              </Section>
            )}

            {/* Reflection */}
            {reflection && (
              <Section title="Reflection (after this experiment)">
                <div className="text-xs space-y-1.5">
                  <p className="text-zinc-300">
                    <span className="text-zinc-500">Ruled out:</span>{" "}
                    {reflection.ruledOut}
                  </p>
                  <p className="text-zinc-300">
                    <span className="text-zinc-500">Surprise rate:</span>{" "}
                    {reflection.surpriseRateAnalysis}
                  </p>
                  {reflection.unexpectedResultDescription && (
                    <p className="text-zinc-300">
                      <span className="text-zinc-500">Unexpected:</span>{" "}
                      {reflection.unexpectedResultDescription}
                    </p>
                  )}
                </div>
              </Section>
            )}

            {/* Experiment Log */}
            {logContent && (
              <Section title="Experiment Log">
                <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-xs">
                  <MarkdownContent content={logContent} />
                </div>
              </Section>
            )}

            {/* View in Console link */}
            {onSeeInConsole && (
              <button
                onClick={() => onSeeInConsole(experiment.timestamp)}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
              >
                <span>→</span> View in Console
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Helper components ─────────────────────────────────────── */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500 mb-1.5">{title}</p>
      {children}
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
        {label}
      </p>
      <p className="text-sm font-mono text-zinc-200">{value}</p>
    </div>
  );
}

function OracleInline({ record }: { record: OracleRecord }) {
  return (
    <div className="text-xs space-y-2 rounded border border-zinc-800 bg-zinc-950 p-3">
      <div>
        <span className="text-zinc-500">Question: </span>
        <span className="text-zinc-300">{record.question}</span>
      </div>
      {record.queryType && (
        <span
          className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${
            record.queryType === "adversarial"
              ? "border-red-800/50 text-red-400 bg-red-900/20"
              : record.queryType === "confirmatory"
                ? "border-emerald-800/50 text-emerald-400 bg-emerald-900/20"
                : "border-zinc-700 text-zinc-400"
          }`}
        >
          {record.queryType}
        </span>
      )}
      <div>
        <span className="text-zinc-500">Synthesis: </span>
        <span className="text-zinc-300">
          {record.claudeFinal.length > 300
            ? record.claudeFinal.slice(0, 300) + "…"
            : record.claudeFinal}
        </span>
      </div>
      {record.actionItems.length > 0 && (
        <div>
          <span className="text-zinc-500">Actions: </span>
          <span className="text-zinc-300">
            {record.actionItems.slice(0, 3).join(" • ")}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">Confidence:</span>
        <span
          className={
            record.confidence === "high"
              ? "text-emerald-400"
              : record.confidence === "medium"
                ? "text-amber-400"
                : "text-red-400"
          }
        >
          {record.confidence}
        </span>
      </div>
    </div>
  );
}

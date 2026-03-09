"use client";

import { useState } from "react";
import type { InteractionRecord } from "@/lib/forge-types";

export function CostDisplay({
  costUsd,
  inputTokens,
  outputTokens,
  compact,
  interactions,
}: {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  compact?: boolean;
  interactions?: InteractionRecord[];
}) {
  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  if (compact) {
    return (
      <span className="font-mono text-sm text-zinc-300">
        ${costUsd.toFixed(2)}
      </span>
    );
  }

  const ixs = interactions ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 text-sm">
        <span className="font-mono text-zinc-100">${costUsd.toFixed(2)}</span>
        <span className="text-zinc-500">
          {fmt(inputTokens)} in / {fmt(outputTokens)} out
        </span>
        {ixs.length > 0 && (
          <span className="text-zinc-600 text-xs">
            {ixs.length} API calls
          </span>
        )}
      </div>

      {ixs.length > 0 && <InteractionsTable interactions={ixs} />}
    </div>
  );
}

function InteractionsTable({ interactions }: { interactions: InteractionRecord[] }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
    } catch {
      return "";
    }
  };

  const providerBadge = (provider: string) => {
    if (provider === "chatgpt") {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/40 text-green-400 border border-green-800/50">
          GPT
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-900/40 text-orange-400 border border-orange-800/50">
        Claude
      </span>
    );
  };

  const purposeLabel = (purpose: string) => {
    switch (purpose) {
      case "agent-turn": return "Agent";
      case "oracle-initial": return "Oracle init";
      case "oracle-review": return "Oracle review";
      case "oracle-synthesis": return "Oracle synth";
      default: return purpose;
    }
  };

  return (
    <div className="mt-3">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {expanded ? "Hide" : "Show"} interactions
      </button>

      {expanded && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left py-1.5 pr-3 font-medium">Time</th>
                <th className="text-left py-1.5 pr-3 font-medium">Provider</th>
                <th className="text-left py-1.5 pr-3 font-medium">Purpose</th>
                <th className="text-right py-1.5 pr-3 font-medium">In</th>
                <th className="text-right py-1.5 pr-3 font-medium">Out</th>
                <th className="text-right py-1.5 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {interactions.map((ix) => (
                <InteractionRow
                  key={ix.id}
                  ix={ix}
                  fmt={fmt}
                  formatTime={formatTime}
                  providerBadge={providerBadge}
                  purposeLabel={purposeLabel}
                  isExpanded={expandedRow === ix.id}
                  onToggle={() => setExpandedRow(expandedRow === ix.id ? null : ix.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InteractionRow({
  ix,
  fmt,
  formatTime,
  providerBadge,
  purposeLabel,
  isExpanded,
  onToggle,
}: {
  ix: InteractionRecord;
  fmt: (n: number) => string;
  formatTime: (ts: string) => string;
  providerBadge: (provider: string) => React.ReactNode;
  purposeLabel: (purpose: string) => string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer transition-colors"
      >
        <td className="py-1.5 pr-3 text-zinc-400 font-mono">
          {formatTime(ix.timestamp)}
        </td>
        <td className="py-1.5 pr-3">{providerBadge(ix.provider)}</td>
        <td className="py-1.5 pr-3 text-zinc-300">{purposeLabel(ix.purpose)}</td>
        <td className="py-1.5 pr-3 text-right text-zinc-400 font-mono">
          {fmt(ix.inputTokens)}
        </td>
        <td className="py-1.5 pr-3 text-right text-zinc-400 font-mono">
          {fmt(ix.outputTokens)}
        </td>
        <td className="py-1.5 text-right text-zinc-300 font-mono">
          ${ix.costUsd.toFixed(4)}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6} className="py-2 px-2">
            <div className="space-y-2 text-[11px]">
              <div>
                <span className="text-zinc-500 font-medium">Sent: </span>
                <span className="text-zinc-400">{ix.sentSummary || "—"}</span>
              </div>
              <div>
                <span className="text-zinc-500 font-medium">Received: </span>
                <span className="text-zinc-400">{ix.receivedSummary || "—"}</span>
              </div>
              <div className="text-zinc-600">
                Model: {ix.model}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import type { OracleRecord } from "@/lib/forge-types";
import { MarkdownContent } from "./MarkdownContent";

const confidenceStyles = {
  high: "bg-emerald-900/50 text-emerald-400 border-emerald-800",
  medium: "bg-amber-900/50 text-amber-400 border-amber-800",
  low: "bg-red-900/50 text-red-400 border-red-800",
};

export function OracleCard({ oracle }: { oracle: OracleRecord }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const date = new Date(oracle.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const toggle = (key: string) =>
    setExpanded((prev) => (prev === key ? null : key));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 mr-3">
          <p className="text-sm font-medium text-zinc-100">{oracle.question}</p>
          <p className="text-xs text-zinc-500 mt-1">{date}</p>
        </div>
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${confidenceStyles[oracle.confidence]}`}
        >
          {oracle.confidence}
        </span>
      </div>

      {/* Collapsible sections */}
      <div className="space-y-2 mt-4">
        <Section
          title="Claude Initial"
          content={oracle.claudeInitial}
          isOpen={expanded === "claude"}
          onToggle={() => toggle("claude")}
        />
        <Section
          title="ChatGPT Review"
          content={oracle.chatgptResponse}
          isOpen={expanded === "chatgpt"}
          onToggle={() => toggle("chatgpt")}
        />
        <Section
          title="Final Synthesis"
          content={oracle.claudeFinal}
          isOpen={expanded === "final"}
          onToggle={() => toggle("final")}
          highlight
        />
      </div>

      {oracle.actionItems.length > 0 && (
        <div className="mt-4 pt-3 border-t border-zinc-800">
          <p className="text-xs font-medium text-zinc-400 mb-2">
            Action Items
          </p>
          <ul className="space-y-1">
            {oracle.actionItems.map((item, i) => (
              <li key={i} className="text-sm text-zinc-300 pl-4 relative">
                <span className="absolute left-0 text-zinc-600">{i + 1}.</span>
                <MarkdownContent content={item} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  content,
  isOpen,
  onToggle,
  highlight,
}: {
  title: string;
  content: string;
  isOpen: boolean;
  onToggle: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded border ${highlight ? "border-zinc-700 bg-zinc-800/50" : "border-zinc-800"}`}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-zinc-800/50 transition-colors"
      >
        <span className={highlight ? "text-zinc-200 font-medium" : "text-zinc-400"}>
          {title}
        </span>
        <span className="text-zinc-600 text-xs">
          {isOpen ? "collapse" : "expand"}
        </span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3">
          <MarkdownContent content={content} />
        </div>
      )}
    </div>
  );
}

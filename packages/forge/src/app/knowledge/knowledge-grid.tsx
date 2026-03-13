"use client";

import { useState } from "react";
import type { KnowledgeTopic } from "@/lib/forge-types";
import { MarkdownContent } from "@/components/MarkdownContent";

export function KnowledgeGrid({
  topics,
  notes,
}: {
  topics: KnowledgeTopic[];
  notes: KnowledgeTopic[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [section, setSection] = useState<"topics" | "notes">("topics");
  const items = section === "topics" ? topics : notes;

  return (
    <div>
      {notes.length > 0 && (
        <div className="flex gap-1 border-b border-zinc-800 mb-6">
          <button
            onClick={() => setSection("topics")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              section === "topics"
                ? "text-zinc-100 border-b-2 border-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Topics ({topics.length})
          </button>
          <button
            onClick={() => setSection("notes")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              section === "notes"
                ? "text-zinc-100 border-b-2 border-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Agent Notes ({notes.length})
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`rounded-lg border bg-zinc-900 p-5 cursor-pointer transition-all ${
              expandedId === item.id
                ? "border-zinc-600 col-span-full"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
            onClick={() =>
              setExpandedId(expandedId === item.id ? null : item.id)
            }
          >
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-semibold text-zinc-100">
                {item.topic}
              </h3>
              {item.updated && (
                <span className="text-xs text-zinc-600">{item.updated}</span>
              )}
            </div>

            {item.relevance.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {item.relevance.map((tag) => (
                  <span
                    key={tag}
                    className="inline-block rounded-full bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {expandedId === item.id ? (
              <div className="mt-3 pt-3 border-t border-zinc-800">
                <MarkdownContent content={item.content} />
              </div>
            ) : (
              <p className="text-xs text-zinc-500 line-clamp-2">
                {item.content.slice(0, 150).trim()}...
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

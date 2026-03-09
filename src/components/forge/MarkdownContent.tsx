"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-strong:text-zinc-200 prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-zinc-300 prose-pre:bg-zinc-800 prose-pre:border prose-pre:border-zinc-700 prose-a:text-blue-400 prose-table:text-zinc-300 prose-th:text-zinc-200 prose-td:border-zinc-700 prose-th:border-zinc-700 prose-li:text-zinc-300">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

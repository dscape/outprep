"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { SessionStatus } from "@/lib/forge-types";

interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  msg: string;
}

export function ConsoleLogViewer({
  sessionId,
  sessionStatus,
  highlightTs,
}: {
  sessionId: string;
  sessionStatus: SessionStatus;
  highlightTs?: string;
}) {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [stayInPlace, setStayInPlace] = useState(false);
  const [connected, setConnected] = useState(false);
  const [done, setDone] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [collapsedEntries, setCollapsedEntries] = useState<Set<number>>(new Set());
  const bufferRef = useRef<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pausedRef = useRef(paused);
  const stayInPlaceRef = useRef(stayInPlace);

  pausedRef.current = paused;
  stayInPlaceRef.current = stayInPlace;

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!paused) {
      // Flush buffer on unpause
      if (bufferRef.current.length > 0) {
        setLines((prev) => [...prev, ...bufferRef.current]);
        bufferRef.current = [];
      }
      if (!stayInPlace) {
        scrollToBottom();
      }
    }
  }, [paused, stayInPlace, scrollToBottom]);

  // Scroll to the closest line matching highlightTs
  useEffect(() => {
    if (!highlightTs || lines.length === 0) return;
    const targetTime = new Date(highlightTs).getTime();
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < lines.length; i++) {
      const diff = Math.abs(new Date(lines[i].ts).getTime() - targetTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    setHighlightIdx(bestIdx);
    const el = lineRefs.current.get(bestIdx);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightTs, lines.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const es = new EventSource(`/api/${sessionId}/logs`);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (event) => {
      try {
        const entry: LogEntry = JSON.parse(event.data);
        if (pausedRef.current) {
          bufferRef.current.push(entry);
        } else {
          setLines((prev) => [...prev, entry]);
          if (!stayInPlaceRef.current) {
            requestAnimationFrame(() => {
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            });
          }
        }
      } catch {
        // skip malformed lines
      }
    };

    es.addEventListener("done", () => {
      setDone(true);
      setConnected(false);
      es.close();
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, [sessionId]);

  const levelColor = (level: string) => {
    switch (level) {
      case "error":
        return "text-red-400";
      case "warn":
        return "text-amber-400";
      default:
        return "text-zinc-300";
    }
  };

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
    } catch {
      return "";
    }
  };

  const isCollapsible = (msg: string) => msg.split("\n").length > 3;

  const toggleCollapse = (index: number) => {
    setCollapsedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const collapseAll = () => {
    const toCollapse = new Set<number>();
    lines.forEach((entry, i) => {
      if (isCollapsible(entry.msg)) toCollapse.add(i);
    });
    setCollapsedEntries(toCollapse);
  };

  const expandAll = () => {
    setCollapsedEntries(new Set());
  };

  const hasCollapsible = lines.some((entry) => isCollapsible(entry.msg));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900">
        <div className="flex items-center gap-3">
          <p className="text-xs font-medium text-zinc-400">Console Output</p>
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? "bg-green-500" : done ? "bg-zinc-600" : "bg-red-500"
            }`}
            title={connected ? "Connected" : done ? "Done" : "Disconnected"}
          />
          <span className="text-xs text-zinc-600">
            {lines.length} lines
          </span>
        </div>
        <div className="flex items-center gap-2">
          {paused && bufferRef.current.length > 0 && (
            <span className="text-xs text-amber-400">
              {bufferRef.current.length} new
            </span>
          )}
          <button
            onClick={() => setPaused((p) => !p)}
            className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
              paused
                ? "bg-green-900/40 text-green-400 hover:bg-green-900/60"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => {
              const next = !stayInPlace;
              setStayInPlace(next);
              if (!next) scrollToBottom();
            }}
            className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
              stayInPlace
                ? "bg-blue-900/40 text-blue-400 hover:bg-blue-900/60"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
            title={stayInPlace ? "Click to resume auto-scroll to bottom" : "Click to pin scroll position"}
          >
            {stayInPlace ? "\u{1F4CC} Pinned" : "Stay in Place"}
          </button>
          {hasCollapsible && (
            <button
              onClick={collapsedEntries.size > 0 ? expandAll : collapseAll}
              className="px-3 py-1 text-xs rounded font-medium bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
            >
              {collapsedEntries.size > 0 ? "Expand All" : "Collapse All"}
            </button>
          )}
          <button
            onClick={() => {
              const text = lines
                .map((l) => `${formatTime(l.ts)} ${l.msg}`)
                .join("\n");
              navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
            className="px-3 py-1 text-xs rounded font-medium bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
          >
            {copied ? "Copied!" : "Copy All"}
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        className="max-h-[600px] overflow-y-auto p-4 font-mono text-xs leading-5"
      >
        {lines.length === 0 && !done && (
          <p className="text-zinc-600">Waiting for console output...</p>
        )}
        {lines.length === 0 && done && (
          <p className="text-zinc-600">No console output recorded.</p>
        )}
        {lines.map((entry, i) => {
          const collapsible = isCollapsible(entry.msg);
          const collapsed = collapsedEntries.has(i);
          const msgLines = entry.msg.split("\n");
          const lineCount = msgLines.length;

          return (
            <div
              key={i}
              ref={(el) => {
                if (el) lineRefs.current.set(i, el);
              }}
              className={`flex gap-2 ${
                highlightIdx === i
                  ? "bg-amber-900/30 border-l-2 border-amber-400 pl-2 -ml-2"
                  : ""
              }`}
            >
              {/* Collapse caret */}
              <span
                className={`shrink-0 select-none w-3 text-center ${
                  collapsible
                    ? "text-zinc-500 cursor-pointer hover:text-zinc-300"
                    : "text-transparent"
                }`}
                onClick={() => collapsible && toggleCollapse(i)}
                role={collapsible ? "button" : undefined}
                tabIndex={collapsible ? 0 : undefined}
                onKeyDown={(e) => {
                  if (collapsible && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    toggleCollapse(i);
                  }
                }}
              >
                {collapsible ? (collapsed ? "\u25B6" : "\u25BC") : "\u00B7"}
              </span>
              <span className="text-zinc-600 shrink-0 select-none">
                {formatTime(entry.ts)}
              </span>
              <pre className={`${levelColor(entry.level)} whitespace-pre-wrap break-all`}>
                {collapsed
                  ? `${msgLines[0]} \u2026 (+${lineCount - 1} lines)`
                  : entry.msg}
              </pre>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      {done && (
        <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900">
          <p className="text-xs text-zinc-500">Session complete</p>
        </div>
      )}
    </div>
  );
}

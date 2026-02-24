import { useState, useCallback } from "react";
import type { TestResult } from "../types";
import { parseTestResult } from "../lib/parse-results";

export function useResults() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addResult = useCallback((result: TestResult) => {
    setResults((prev) => {
      // Don't add duplicates (same label + timestamp)
      if (
        prev.some(
          (r) => r.label === result.label && r.timestamp === result.timestamp
        )
      ) {
        return prev;
      }
      return [...prev, result];
    });
    setError(null);
  }, []);

  const loadFromFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const parsed = parseTestResult(data);
        if (!parsed) {
          setError(`Invalid result file: ${file.name}`);
          return;
        }
        addResult(parsed);
      } catch {
        setError(`Failed to parse ${file.name}`);
      }
    },
    [addResult]
  );

  const removeResult = useCallback((index: number) => {
    setResults((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAll = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return { results, error, loadFromFile, removeResult, clearAll };
}

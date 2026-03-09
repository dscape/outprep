export function CostDisplay({
  costUsd,
  inputTokens,
  outputTokens,
  compact,
}: {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  compact?: boolean;
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

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="font-mono text-zinc-100">${costUsd.toFixed(2)}</span>
      <span className="text-zinc-500">
        {fmt(inputTokens)} in / {fmt(outputTokens)} out
      </span>
    </div>
  );
}

export function MetricDelta({
  label,
  value,
  invert,
  percentage,
}: {
  label: string;
  value: number;
  /** If true, negative is good (e.g. KL divergence) */
  invert?: boolean;
  percentage?: boolean;
}) {
  const isGood = invert ? value < 0 : value > 0;
  const color = value === 0 ? "text-zinc-500" : isGood ? "text-emerald-400" : "text-red-400";
  const sign = value > 0 ? "+" : "";
  const display = percentage
    ? `${sign}${(value * 100).toFixed(1)}%`
    : `${sign}${value.toFixed(4)}`;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-mono ${color}`}>{display}</span>
    </div>
  );
}
